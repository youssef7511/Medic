'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, ResourceNotFoundError } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';

export type UserActionState = { error?: string; ok?: boolean };

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
  const { userId, role } = parsed.data;
  const scopeId = parsed.data.scopeId ?? undefined;

  // Verify the target user exists.
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!targetUser) throw new ResourceNotFoundError();

  // Upsert the role assignment (idempotent on @@unique([userId, role, scopeId])).
  const uniqueKey = scopeId
    ? { userId, role: role as Role, scopeId }
    : { userId, role: role as Role, scopeId: null as unknown as string };

  await prisma.$transaction(async (tx) => {
    await tx.roleAssignment.upsert({
      where: { userId_role_scopeId: uniqueKey },
      create: {
        userId,
        role: role as Role,
        scopeType: scopeId ? 'DOCTOR' : 'GLOBAL',
        scopeId: scopeId ?? null,
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
      metadata: { role, scopeId: scopeId ?? null },
    });
  });

  revalidatePath('/admin/users');
  return { ok: true };
}
