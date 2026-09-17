import { DateTime } from 'luxon';
import { prisma } from '@/lib/db';
import { localeNumberingSystem, type Locale } from '@/i18n/config';

/**
 * Read models for the appointment lists.
 *
 * Both queries are scoped through PatientDoctorLink (§2) rather than filtering
 * on a raw id: the patient view joins links where patientId is theirs, the
 * doctor view joins links where doctorId is theirs. There is no query shape
 * here that could return someone else's appointment.
 *
 * Note neither selects reasonEnc — a list view has no need for the clinical
 * free text, so it isn't loaded or decrypted (§3.1).
 */

export interface AppointmentRow {
  id: string;
  status: string;
  startAtIso: string;
  whenLabel: string;
  counterpartyName: string;
  clinicName: string;
  isPast: boolean;
}

function formatWhen(startAt: Date, timezone: string, locale: string): string {
  const numbering = localeNumberingSystem[locale as Locale] ?? 'latn';
  return DateTime.fromJSDate(startAt)
    .setZone(timezone)
    .setLocale(`${locale}-u-nu-${numbering}`)
    .toLocaleString({
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
}

export async function getPatientAppointments(
  userId: string,
  locale: string,
  now = new Date(),
): Promise<AppointmentRow[]> {
  const rows = await prisma.appointment.findMany({
    where: { link: { patient: { userId } } },
    select: {
      id: true,
      status: true,
      startAt: true,
      clinic: { select: { name: true } },
      link: { select: { doctor: { select: { headline: true, slug: true, timezone: true } } } },
    },
    orderBy: { startAt: 'desc' },
    take: 100,
  });

  return rows.map((r) => {
    const headline = r.link.doctor.headline as Record<Locale, string> | null;
    return {
      id: r.id,
      status: r.status,
      startAtIso: r.startAt.toISOString(),
      whenLabel: formatWhen(r.startAt, r.link.doctor.timezone, locale),
      counterpartyName: headline?.[locale as Locale] ?? r.link.doctor.slug,
      clinicName: r.clinic.name,
      isPast: r.startAt.getTime() <= now.getTime(),
    };
  });
}

export async function getDoctorAppointments(
  userId: string,
  locale: string,
  now = new Date(),
): Promise<AppointmentRow[]> {
  const doctor = await prisma.doctorProfile.findUnique({
    where: { userId },
    select: { id: true, timezone: true },
  });
  if (!doctor) return [];

  const rows = await prisma.appointment.findMany({
    where: {
      link: { doctorId: doctor.id },
      // Upcoming plus a short tail, so no-shows can still be marked.
      startAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
    },
    select: {
      id: true,
      status: true,
      startAt: true,
      clinic: { select: { name: true } },
      link: { select: { patient: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { startAt: 'asc' },
    take: 200,
  });

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    startAtIso: r.startAt.toISOString(),
    whenLabel: formatWhen(r.startAt, doctor.timezone, locale),
    counterpartyName: `${r.link.patient.firstName} ${r.link.patient.lastName}`,
    clinicName: r.clinic.name,
    isPast: r.startAt.getTime() <= now.getTime(),
  }));
}
