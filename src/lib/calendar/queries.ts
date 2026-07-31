import { DateTime } from 'luxon';
import { prisma } from '@/lib/db';
import type { Locale } from '@/i18n/config';
import { localeNumberingSystem } from '@/i18n/config';
import { buildWeek, computeDayBounds, type WeekDay } from './layout';

/**
 * Read model for the doctor's week calendar.
 *
 * Scoped through PatientDoctorLink like every other doctor-side query (§2), and
 * selects no clinical fields — a calendar shows who and when, never why. The
 * reason-for-visit stays encrypted and unread here (§3.1).
 */

export interface CalendarEvent {
  id: string;
  startAt: Date;
  endAt: Date;
  status: string;
  patientName: string;
  clinicName: string;
  timeLabel: string;
}

export interface AvailabilityBand {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  startMinutes: number;
  endMinutes: number;
}

export interface WeekCalendar {
  days: WeekDay[];
  events: CalendarEvent[];
  bands: AvailabilityBand[];
  closedDates: string[];
  bounds: { startHour: number; endHour: number };
  timezone: string;
  rangeLabel: string;
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export async function getWeekCalendar(args: {
  userId: string;
  anchor: Date;
  locale: string;
  now?: Date;
}): Promise<WeekCalendar | null> {
  const { userId, anchor, locale, now = new Date() } = args;

  const doctor = await prisma.doctorProfile.findUnique({
    where: { userId },
    select: { id: true, timezone: true },
  });
  if (!doctor) return null;

  const tz = doctor.timezone;
  const numbering = localeNumberingSystem[locale as Locale] ?? 'latn';
  const intlLocale = `${locale}-u-nu-${numbering}`;

  const days = buildWeek({ anchor, timezone: tz, locale: intlLocale, now });
  const firstDay = days[0]!;
  const lastDay = days[6]!;

  // Query bounds are the week's edges expressed as real instants in the
  // doctor's zone — not naive UTC midnights, which would clip an hour.
  const rangeStart = DateTime.fromISO(firstDay.isoDate, { zone: tz }).startOf('day');
  const rangeEnd = DateTime.fromISO(lastDay.isoDate, { zone: tz }).endOf('day');

  const [appointments, rules, exceptions] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        link: { doctorId: doctor.id },
        startAt: { gte: rangeStart.toJSDate(), lte: rangeEnd.toJSDate() },
        status: { in: ['REQUESTED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'] },
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        clinic: { select: { name: true } },
        link: { select: { patient: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { startAt: 'asc' },
    }),
    prisma.availabilityRule.findMany({ where: { doctorId: doctor.id } }),
    prisma.availabilityException.findMany({
      where: {
        doctorId: doctor.id,
        date: { gte: rangeStart.toJSDate(), lte: rangeEnd.toJSDate() },
      },
    }),
  ]);

  const events: CalendarEvent[] = appointments.map((a) => ({
    id: a.id,
    startAt: a.startAt,
    endAt: a.endAt,
    status: a.status,
    patientName: `${a.link.patient.firstName} ${a.link.patient.lastName}`,
    clinicName: a.clinic.name,
    timeLabel: DateTime.fromJSDate(a.startAt)
      .setZone(tz)
      .setLocale(intlLocale)
      .toLocaleString({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  }));

  const bands: AvailabilityBand[] = rules.flatMap((r) => {
    const start = toMinutes(r.startLocal);
    const end = toMinutes(r.endLocal);
    if (start === null || end === null || end <= start) return [];
    return [{ weekday: r.weekday, startMinutes: start, endMinutes: end }];
  });

  const closedDates = exceptions
    .filter((e) => e.isClosed)
    .map((e) => DateTime.fromJSDate(e.date, { zone: 'utc' }).toISODate() ?? '');

  // Bounds consider both what the doctor offers and what's actually booked, so
  // an out-of-hours appointment can never render outside the visible grid.
  const eventWindows = events.map((e) => ({
    startMinutes:
      DateTime.fromJSDate(e.startAt).setZone(tz).hour * 60 +
      DateTime.fromJSDate(e.startAt).setZone(tz).minute,
    endMinutes:
      DateTime.fromJSDate(e.endAt).setZone(tz).hour * 60 +
      DateTime.fromJSDate(e.endAt).setZone(tz).minute,
  }));

  const bounds = computeDayBounds([
    ...bands.map((b) => ({ startMinutes: b.startMinutes, endMinutes: b.endMinutes })),
    ...eventWindows.filter((w) => w.endMinutes > w.startMinutes),
  ]);

  const rangeLabel = `${rangeStart.setLocale(intlLocale).toFormat('d MMM')} – ${rangeEnd
    .setLocale(intlLocale)
    .toFormat('d MMM yyyy')}`;

  return { days, events, bands, closedDates, bounds, timezone: tz, rangeLabel };
}
