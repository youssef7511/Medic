import { BreakGlassStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auditCritical } from '@/lib/audit';
import { decryptText } from '@/lib/crypto/envelope';
import { verifyMfaToken } from '@/lib/auth/totp';
import {
  hasPermission,
  PermissionDeniedError,
  ResourceNotFoundError,
  type Actor,
} from '@/lib/rbac/guard';
import { BREAK_GLASS_NOTIFICATION_TOPIC } from '@/lib/notifications/security';

export const MAX_BREAK_GLASS_MINUTES = 30;
export const MIN_BREAK_GLASS_MINUTES = 5;

export class BreakGlassValidationError extends Error {
  constructor(public readonly code: string) {
    super(`Invalid break-glass request: ${code}`);
    this.name = 'BreakGlassValidationError';
  }
}

export function validateBreakGlassRequest(
  reason: string,
  durationMinutes: number,
  totp: string,
): string {
  const trimmed = reason.trim();
  if (trimmed.length < 20 || trimmed.length > 500) {
    throw new BreakGlassValidationError('reason_length');
  }
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < MIN_BREAK_GLASS_MINUTES ||
    durationMinutes > MAX_BREAK_GLASS_MINUTES
  ) {
    throw new BreakGlassValidationError('duration');
  }
  if (!/^\d{6}$/.test(totp.trim())) throw new BreakGlassValidationError('totp');
  return trimmed;
}

export async function activateBreakGlass(
  actor: Actor,
  args: { patientId: string; reason: string; durationMinutes: number; totp: string },
): Promise<{ id: string; expiresAt: Date }> {
  if (!hasPermission(actor, 'break_glass:activate')) throw new PermissionDeniedError();
  const reason = validateBreakGlassRequest(args.reason, args.durationMinutes, args.totp);

  const [admin, patient] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { mfaSecret: true, status: true },
    }),
    prisma.patientProfile.findUnique({
      where: { id: args.patientId },
      select: { id: true },
    }),
  ]);
  if (!admin?.mfaSecret || admin.status !== 'ACTIVE') throw new PermissionDeniedError();
  if (!verifyMfaToken(args.totp, admin.mfaSecret)) {
    throw new BreakGlassValidationError('totp');
  }
  if (!patient) throw new ResourceNotFoundError();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + args.durationMinutes * 60_000);

  return prisma.$transaction(async (tx) => {
    // A second activation replaces, rather than extends, an earlier grant.
    await tx.breakGlassGrant.updateMany({
      where: {
        actorUserId: actor.userId,
        patientId: patient.id,
        status: BreakGlassStatus.ACTIVE,
      },
      data: { status: BreakGlassStatus.REVOKED, revokedAt: now },
    });

    const grant = await tx.breakGlassGrant.create({
      data: {
        actorUserId: actor.userId,
        patientId: patient.id,
        reason,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    // Patient notification is transactional with activation. The outbox keeps
    // access creation available even if the provider is temporarily down.
    await tx.outboxMessage.create({
      data: {
        topic: BREAK_GLASS_NOTIFICATION_TOPIC,
        payload: { grantId: grant.id },
        scheduledFor: now,
      },
    });

    await auditCritical(tx, {
      actorUserId: actor.userId,
      actorRole: Role.SUPER_ADMIN,
      action: 'break_glass.activated',
      resourceType: 'BreakGlassGrant',
      resourceId: grant.id,
      patientId: patient.id,
      metadata: { expiresAt: expiresAt.toISOString(), durationMinutes: args.durationMinutes },
    });

    return grant;
  });
}

export async function requireBreakGlass(actor: Actor, grantId: string) {
  if (!hasPermission(actor, 'break_glass:activate')) throw new ResourceNotFoundError();
  const grant = await prisma.breakGlassGrant.findFirst({
    where: {
      id: grantId,
      actorUserId: actor.userId,
      status: BreakGlassStatus.ACTIVE,
      expiresAt: { gt: new Date() },
    },
  });
  if (!grant) throw new ResourceNotFoundError();
  return grant;
}

export async function revokeBreakGlass(actor: Actor, grantId: string): Promise<void> {
  const grant = await requireBreakGlass(actor, grantId);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const result = await tx.breakGlassGrant.updateMany({
      where: { id: grant.id, actorUserId: actor.userId, status: BreakGlassStatus.ACTIVE },
      data: { status: BreakGlassStatus.REVOKED, revokedAt: now },
    });
    if (result.count !== 1) throw new ResourceNotFoundError();
    await auditCritical(tx, {
      actorUserId: actor.userId,
      actorRole: Role.SUPER_ADMIN,
      action: 'break_glass.revoked',
      resourceType: 'BreakGlassGrant',
      resourceId: grant.id,
      patientId: grant.patientId,
    });
  });
}

/**
 * Exceptional read path. It never changes the normal role matrix: every call
 * proves a live grant and emits a loud, patient-indexed audit event.
 */
export async function getBreakGlassSnapshot(actor: Actor, grantId: string) {
  const grant = await requireBreakGlass(actor, grantId);
  const patient = await prisma.patientProfile.findUnique({
    where: { id: grant.patientId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      allergiesEnc: true,
      allergiesAffirmedNone: true,
      user: { select: { email: true } },
      links: {
        select: {
          doctor: { select: { headline: true } },
          notes: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, contentEnc: true, status: true, createdAt: true },
          },
          threads: {
            select: {
              id: true,
              messages: {
                orderBy: { createdAt: 'asc' },
                select: { id: true, bodyEnc: true, senderUserId: true, createdAt: true },
              },
            },
          },
          documents: {
            orderBy: { issuedAt: 'desc' },
            select: { id: true, type: true, status: true, issuedAt: true },
          },
        },
      },
    },
  });
  if (!patient) throw new ResourceNotFoundError();

  const links = await Promise.all(
    patient.links.map(async (link) => ({
      doctorHeadline: link.doctor.headline,
      notes: await Promise.all(
        link.notes.map(async (note) => ({
          id: note.id,
          content: await decryptText(note.contentEnc),
          status: note.status,
          createdAt: note.createdAt,
        })),
      ),
      threads: await Promise.all(
        link.threads.map(async (thread) => ({
          id: thread.id,
          messages: await Promise.all(
            thread.messages.map(async (message) => ({
              id: message.id,
              body: await decryptText(message.bodyEnc),
              senderUserId: message.senderUserId,
              createdAt: message.createdAt,
            })),
          ),
        })),
      ),
      documents: link.documents,
    })),
  );

  await auditCritical(prisma, {
    actorUserId: actor.userId,
    actorRole: Role.SUPER_ADMIN,
    action: 'break_glass.clinical_snapshot_read',
    resourceType: 'BreakGlassGrant',
    resourceId: grant.id,
    patientId: patient.id,
    metadata: {
      linkCount: links.length,
      noteCount: links.reduce((n, link) => n + link.notes.length, 0),
      messageCount: links.reduce(
        (n, link) => n + link.threads.reduce((m, thread) => m + thread.messages.length, 0),
        0,
      ),
    },
  });

  return {
    grant: { id: grant.id, reason: grant.reason, expiresAt: grant.expiresAt },
    patient: {
      id: patient.id,
      name: `${patient.firstName} ${patient.lastName}`,
      email: patient.user.email,
      allergies: patient.allergiesEnc ? await decryptText(patient.allergiesEnc) : null,
      allergiesAffirmedNone: patient.allergiesAffirmedNone,
    },
    links,
  };
}
