import { AppointmentStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { requireLink, requireLinkAny, ResourceNotFoundError, type Actor } from '@/lib/rbac/guard';
import { cancelPendingFor, enqueueMessages } from '@/lib/notifications/outbox';
import { planReminders, TOPICS } from '@/lib/notifications/schedule';
import { assertTransition, canMarkNoShow } from './state';

export class AppointmentClosedError extends Error {
  constructor(message = 'This appointment can no longer be changed.') {
    super(message);
    this.name = 'AppointmentClosedError';
  }
}

/** Loads an appointment and proves the actor may act on it (§5). */
async function loadAuthorized(actor: Actor, appointmentId: string, permissions: string[]) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, linkId: true, status: true, startAt: true, endAt: true },
  });
  // 404, not 403 — never confirm an id exists to someone out of scope (§5).
  if (!appointment) throw new ResourceNotFoundError();

  const link = await requireLinkAny(
    actor,
    appointment.linkId,
    permissions as Parameters<typeof requireLink>[2][],
  );

  return { appointment, link };
}

function actorRoleLabel(actor: Actor): string {
  return actor.roles.map((r) => r.role).join(',') || 'UNKNOWN';
}

/**
 * Cancels an appointment. Either side may cancel — the permission list covers
 * both the patient's own booking and the practice side, and requireLinkAny
 * resolves whichever applies to this actor.
 */
export async function cancelAppointment(args: {
  actor: Actor;
  appointmentId: string;
  reason?: string;
  now?: Date;
}) {
  const { actor, appointmentId, reason, now = new Date() } = args;

  const { appointment, link } = await loadAuthorized(actor, appointmentId, [
    'appointment:cancel:own',
    'appointment:cancel',
  ]);

  assertTransition(appointment.status, AppointmentStatus.CANCELLED);

  // Once the appointment has started, "cancel" is no longer the honest record
  // of what happened — it either took place (COMPLETED) or it didn't (NO_SHOW).
  // Allowing a retroactive cancel would also let a patient erase a no-show and
  // dodge the §13.4 gating.
  if (appointment.startAt.getTime() <= now.getTime()) {
    throw new AppointmentClosedError(
      'This appointment has already started and cannot be cancelled.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancelledBy: actor.userId,
        ...(reason ? { cancelReason: reason.slice(0, 500) } : {}),
      },
    });

    // Cancelling frees the slot automatically: the exclusion constraint only
    // covers REQUESTED/CONFIRMED (see 001_hardening.sql), so no extra work.

    // Kill the pending "see you tomorrow" reminders before they embarrass us.
    await cancelPendingFor(tx, appointment.id);

    await enqueueMessages(tx, [
      { topic: TOPICS.cancellation, scheduledFor: now, payload: { appointmentId: appointment.id } },
    ]);

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: actorRoleLabel(actor),
      action: 'appointment.cancel',
      resourceType: 'Appointment',
      resourceId: appointment.id,
      patientId: link.patientId,
      metadata: { previousStatus: appointment.status },
    });

    return updated;
  });
}

/**
 * Doctor (or staff) accepts a REQUESTED appointment — the other half of the
 * doctor-vetted default from §13.2. Reminders are scheduled here rather than at
 * booking, because only now is the appointment real.
 */
export async function confirmAppointment(args: {
  actor: Actor;
  appointmentId: string;
  now?: Date;
}) {
  const { actor, appointmentId, now = new Date() } = args;

  const { appointment, link } = await loadAuthorized(actor, appointmentId, ['appointment:confirm']);
  assertTransition(appointment.status, AppointmentStatus.CONFIRMED);

  if (appointment.startAt.getTime() <= now.getTime()) {
    throw new AppointmentClosedError('This appointment has already started.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: AppointmentStatus.CONFIRMED },
    });

    await enqueueMessages(tx, [
      { topic: TOPICS.confirmation, scheduledFor: now, payload: { appointmentId: appointment.id } },
      ...planReminders({ appointmentId: appointment.id, startAt: appointment.startAt, now }),
    ]);

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: actorRoleLabel(actor),
      action: 'appointment.confirm',
      resourceType: 'Appointment',
      resourceId: appointment.id,
      patientId: link.patientId,
    });

    return updated;
  });
}

/** Marks a past appointment as a no-show. Feeds the §13.4 soft gating. */
export async function markNoShow(args: { actor: Actor; appointmentId: string; now?: Date }) {
  const { actor, appointmentId, now = new Date() } = args;

  const { appointment, link } = await loadAuthorized(actor, appointmentId, [
    'appointment:mark_no_show',
  ]);

  if (!canMarkNoShow(appointment.status, appointment.startAt, now)) {
    throw new AppointmentClosedError(
      'Only an appointment that has already started can be marked as a no-show.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: AppointmentStatus.NO_SHOW },
    });

    await cancelPendingFor(tx, appointment.id);

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: actorRoleLabel(actor),
      action: 'appointment.no_show',
      resourceType: 'Appointment',
      resourceId: appointment.id,
      patientId: link.patientId,
    });

    return updated;
  });
}

/** Closes out an attended appointment. */
export async function completeAppointment(args: {
  actor: Actor;
  appointmentId: string;
  now?: Date;
}) {
  const { actor, appointmentId, now = new Date() } = args;

  const { appointment, link } = await loadAuthorized(actor, appointmentId, ['appointment:complete']);
  assertTransition(appointment.status, AppointmentStatus.COMPLETED);

  if (appointment.startAt.getTime() > now.getTime()) {
    throw new AppointmentClosedError('This appointment has not happened yet.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: AppointmentStatus.COMPLETED },
    });

    await cancelPendingFor(tx, appointment.id);

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.DOCTOR,
      action: 'appointment.complete',
      resourceType: 'Appointment',
      resourceId: appointment.id,
      patientId: link.patientId,
    });

    return updated;
  });
}
