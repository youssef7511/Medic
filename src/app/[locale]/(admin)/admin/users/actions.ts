'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, ResourceNotFoundError } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { rolesRequireMfa } from '@/lib/auth/totp';
import {
  generateMfaEnrollmentToken,
  hashMfaEnrollmentToken,
  mfaEnrollmentExpiry,
} from '@/lib/auth/mfa-enrollment';
import {
  InvalidRoleScopeError,
  resolveRoleScope,
} from '@/lib/admin/role-assignment';

export type UserActionState = {
  error?: string;
  ok?: boolean;
  enrollmentToken?: string;
  enrollmentExpiresAt?: string;
};

/**
 * Suspend a user (§5). Only SUPER_ADMIN can do this.
 * Suspended users cannot sign in.
 */
export async function suspendUserAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };
  if (!hasPermission(actor, 'user:suspend')) {
    return { error: 'Permission denied.' };
  }

  const userId = formData.get('userId') as string;
  if (!userId) return { error: 'Missing userId.' };
  if (userId === actor.userId) return { error: 'You cannot suspend your own account.' };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true },
  });
  if (!user) throw new ResourceNotFoundError();
  if (user.status === 'SUSPENDED') return { error: 'Already suspended.' };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED' },
    });

    // Suspension must take effect on the next request, not when a JWT expires.
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.SUPER_ADMIN,
      action: 'user.suspended',
      resourceType: 'User',
      resourceId: userId,
    });
  });

  revalidatePath('/admin/users');
  return { ok: true };
}

/**
 * Reactivate a suspended user (§5). Only SUPER_ADMIN.
 */
export async function reactivateUserAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };
  if (!hasPermission(actor, 'user:suspend')) {
    return { error: 'Permission denied.' };
  }

  const userId = formData.get('userId') as string;
  if (!userId) return { error: 'Missing userId.' };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE' },
    });

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.SUPER_ADMIN,
      action: 'user.reactivated',
      resourceType: 'User',
      resourceId: userId,
    });
  });

  revalidatePath('/admin/users');
  return { ok: true };
}

/**
 * Assign a role to a user (§5). Only SUPER_ADMIN.
 * The role is scoped globally unless a scopeId is provided.
 */
const assignRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['DOCTOR', 'DOCTOR_STAFF', 'SUPPORT_ADMIN', 'SUPER_ADMIN']),
  scopeId: z.string().optional(),
});

export async function assignRoleAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };
  if (!hasPermission(actor, 'role:assign')) {
    return { error: 'Permission denied.' };
  }

  const parsed = assignRoleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
    scopeId: formData.get('scopeId') || undefined,
  });
  if (!parsed.success) return { error: 'Invalid input.' };
  const { userId } = parsed.data;
  const role = parsed.data.role as Role;
  let scope: ReturnType<typeof resolveRoleScope>;
  try {
    scope = resolveRoleScope(role, parsed.data.scopeId);
  } catch (error) {
    if (error instanceof InvalidRoleScopeError) {
      return { error: 'Select the doctor this staff account belongs to.' };
    }
    throw error;
  }

  // Verify the target user exists.
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!targetUser) throw new ResourceNotFoundError();

  if (scope.scopeType === 'DOCTOR') {
    const doctor = await prisma.doctorProfile.findUnique({
      where: { id: scope.scopeId },
      select: { id: true },
    });
    if (!doctor) return { error: 'Selected doctor does not exist.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.roleAssignment.upsert({
      where: {
        userId_role_scopeId: {
          userId,
          role,
          scopeId: scope.scopeId,
        },
      },
      create: {
        userId,
        role,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        grantedBy: actor.userId,
      },
      update: {
        grantedBy: actor.userId,
        grantedAt: new Date(),
      },
    });

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.SUPER_ADMIN,
      action: 'role.assigned',
      resourceType: 'User',
      resourceId: userId,
      metadata: { role, scopeType: scope.scopeType, scopeId: scope.scopeId },
    });
  });

  revalidatePath('/admin/users');
  return { ok: true };
}

/**
 * Creates the out-of-band proof needed for first-time privileged MFA setup.
 * The raw 256-bit token is returned once; only its digest is persisted.
 */
export async function issueMfaEnrollmentTokenAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };
  if (!hasPermission(actor, 'role:assign')) return { error: 'Permission denied.' };

  const userId = String(formData.get('userId') ?? '');
  if (!userId) return { error: 'Missing userId.' };

  const target = await prisma.user.findUnique({
    where: { id: userId },
    include: { roleAssignments: true },
  });
  if (!target) throw new ResourceNotFoundError();
  if (!rolesRequireMfa(target.roleAssignments)) {
    return { error: 'Assign a privileged role before issuing an MFA token.' };
  }
  if (target.mfaSecret) return { error: 'MFA is already enrolled for this user.' };
  if (target.status !== 'ACTIVE') return { error: 'The user account is not active.' };

  const rawToken = generateMfaEnrollmentToken();
  const expiresAt = mfaEnrollmentExpiry();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.mfaEnrollmentToken.updateMany({
      where: { userId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.user.update({
      where: { id: userId },
      data: { mfaPendingSecret: null },
    });
    const token = await tx.mfaEnrollmentToken.create({
      data: {
        userId,
        tokenHash: hashMfaEnrollmentToken(rawToken),
        createdByUserId: actor.userId,
        expiresAt,
      },
    });
    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.SUPER_ADMIN,
      action: 'user.mfa_enrollment_token_issued',
      resourceType: 'User',
      resourceId: userId,
      metadata: { tokenId: token.id, expiresAt: expiresAt.toISOString() },
    });
  });

  revalidatePath('/admin/users');
  return {
    ok: true,
    enrollmentToken: rawToken,
    enrollmentExpiresAt: expiresAt.toISOString(),
  };
}
