import { AppointmentStatus, LinkSource, LinkStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { encryptOptional } from '@/lib/crypto/envelope';
import { enqueueMessages } from '@/lib/notifications/outbox';
import { planBookingMessages } from '@/lib/notifications/schedule';
import { getAvailability } from './availability';
import { NO_SHOW_THRESHOLD, NO_SHOW_WINDOW_DAYS } from './policy';

export class SlotUnavailableError extends Error {
  constructor(message = 'That slot is no longer available.') {
    super(message);
    this.name = 'SlotUnavailableError';
  }
}

/**
 * Postgres raises 23P01 (exclusion_violation) when two bookings race for the
 * same slot — the constraint from prisma/sql/001_hardening.sql. Prisma doesn't
 * map that code to a typed error, so we sniff for it and translate into the
 * friendly "just taken" path (§3, §6).
 */
function isSlotTakenError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes('23P01') ||
    msg.includes('exclusion_violation') ||
    msg.includes('appointment_no_overlap')
  );
}

/**
 * §13.4 — soft, doctor-scoped no-show gating. Counts only this patient's
 * no-shows with THIS doctor, inside the window. Never a platform-wide record.
 */
async function shouldForceManualConfirm(linkId: string): Promise<boolean> {
  const since = new Date(Date.now() - NO_SHOW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const count = await prisma.appointment.count({
    where: { linkId, status: AppointmentStatus.NO_SHOW, startAt: { gte: since } },
  });
  return count >= NO_SHOW_THRESHOLD;
}

export interface BookArgs {
  /** The authenticated patient's User id. */
  userId: string;
  doctorId: string;
  clinicId: string;
  startAt: Date;
  reason?: string;
}

/**
 * Books an appointment (§6).
 *
 * The slot is re-derived from availability immediately before insert — a
 * client-supplied time is never trusted, because the doctor may have changed
 * their hours since the page rendered. Even so, the DB constraint is what
 * actually arbitrates concurrency; this check only produces a nicer error in
 * the common case.
 */
export async function bookAppointment(args: BookArgs) {
  const { userId, doctorId, clinicId, startAt, reason } = args;

  const patient = await prisma.patientProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!patient) throw new SlotUnavailableError('No patient profile for this account.');

  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId, doctorId },
    select: { id: true },
  });
  if (!clinic) throw new SlotUnavailableError('Unknown clinic for this doctor.');

  // Re-derive: is this exact instant still offered?
  const dayStart = new Date(startAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 2); // ±window covers tz edges

  const slots = await getAvailability({ doctorId, clinicId, from: dayStart, to: dayEnd });
  const slot = slots.find((s) => s.startAt.getTime() === startAt.getTime());
  if (!slot) throw new SlotUnavailableError();

  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: doctorId },
    select: { autoConfirm: true },
  });

  const reasonEnc = encryptOptional(reason);

  try {
    return await prisma.$transaction(async (tx) => {
      // The link IS the relationship (§2). First booking creates it.
      const link = await tx.patientDoctorLink.upsert({
        where: { patientId_doctorId: { patientId: patient.id, doctorId } },
        update: {},
        create: {
          patientId: patient.id,
          doctorId,
          source: LinkSource.BOOKING,
          status: LinkStatus.ACTIVE,
        },
      });

      if (link.status === LinkStatus.BLOCKED) {
        throw new SlotUnavailableError('Booking is not available with this doctor.');
      }

      // §13.2 auto-confirm, unless §13.4 no-show gating pulls it back to manual.
      const forceManual = await shouldForceManualConfirm(link.id);
      const status =
        doctor?.autoConfirm && !forceManual
          ? AppointmentStatus.CONFIRMED
          : AppointmentStatus.REQUESTED;

      const appointment = await tx.appointment.create({
        data: {
          linkId: link.id,
          clinicId,
          startAt: slot.startAt,
          endAt: slot.endAt,
          status,
          ...(reasonEnc ? { reasonEnc } : {}),
        },
      });

      await audit(tx, {
        actorUserId: userId,
        actorRole: Role.PATIENT,
        action: 'appointment.book',
        resourceType: 'Appointment',
        resourceId: appointment.id,
        patientId: patient.id,
        metadata: { status, doctorId, clinicId },
      });

      // Notification intent is written in THIS transaction (§6): if the
      // booking rolls back, the SMS intent rolls back with it.
      await enqueueMessages(
        tx,
        planBookingMessages({
          appointmentId: appointment.id,
          startAt: appointment.startAt,
          status: appointment.status,
          now: new Date(),
        }),
      );

      return appointment;
    });
  } catch (e) {
    if (isSlotTakenError(e)) throw new SlotUnavailableError();
    throw e;
  }
}
