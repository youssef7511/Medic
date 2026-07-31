import { DateTime, Interval } from 'luxon';
import { prisma } from '@/lib/db';
import { HORIZON_DAYS, LEAD_TIME_MINUTES } from './policy';

/**
 * §6: slots are COMPUTED, never materialised.
 *
 * A pre-generated `slots` table is millions of rows and turns every
 * availability edit into a migration of future rows. Deriving instead:
 *
 *   available = expand(rules in doctor's local tz)
 *             − exceptions
 *             − existing appointments (REQUESTED | CONFIRMED)
 *             − lead time
 *             − horizon
 */

export interface Slot {
  /** UTC instant. Everything is stored and compared in UTC (§6). */
  startAt: Date;
  endAt: Date;
}

export interface RuleInput {
  weekday: number; // 0 = Sunday … 6 = Saturday
  startLocal: string; // "09:00"
  endLocal: string; // "13:00"
  slotMinutes: number;
  validFrom: Date;
  validUntil: Date | null;
}

export interface ExceptionInput {
  /** Local calendar date, "YYYY-MM-DD". */
  date: string;
  isClosed: boolean;
  startLocal: string | null;
  endLocal: string | null;
}

export interface BookedInput {
  startAt: Date;
  endAt: Date;
}

export interface ComputeSlotsArgs {
  rules: RuleInput[];
  exceptions: ExceptionInput[];
  booked: BookedInput[];
  /** IANA zone, e.g. "Africa/Tunis". Never a fixed offset — DST is real (§6). */
  timezone: string;
  from: Date;
  to: Date;
  now: Date;
  leadTimeMinutes?: number;
  horizonDays?: number;
}

/** Local "HH:mm" → minutes from midnight. Returns null when malformed. */
function parseLocalTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Pure, dependency-free slot computation — no DB, no clock. Every input is
 * explicit (including `now`) so the behaviour is fully testable.
 */
export function computeSlots(args: ComputeSlotsArgs): Slot[] {
  const {
    rules,
    exceptions,
    booked,
    timezone,
    from,
    to,
    now,
    leadTimeMinutes = LEAD_TIME_MINUTES,
    horizonDays = HORIZON_DAYS,
  } = args;

  const earliest = DateTime.fromJSDate(now).plus({ minutes: leadTimeMinutes });
  const latest = DateTime.fromJSDate(now).plus({ days: horizonDays });

  const windowStart = DateTime.fromJSDate(from).setZone(timezone).startOf('day');
  const windowEnd = DateTime.fromJSDate(to).setZone(timezone).endOf('day');
  if (!windowStart.isValid || !windowEnd.isValid) return [];

  const exceptionsByDate = new Map(exceptions.map((e) => [e.date, e]));
  const bookedIntervals = booked.map((b) =>
    Interval.fromDateTimes(DateTime.fromJSDate(b.startAt), DateTime.fromJSDate(b.endAt)),
  );

  const slots: Slot[] = [];

  for (let day = windowStart; day <= windowEnd; day = day.plus({ days: 1 })) {
    const isoDate = day.toISODate();
    if (!isoDate) continue;

    const exception = exceptionsByDate.get(isoDate);

    // A closed exception wipes the day regardless of the weekly rules.
    if (exception?.isClosed) continue;

    // Luxon: 1 = Monday … 7 = Sunday. Schema uses 0 = Sunday … 6 = Saturday.
    const weekday = day.weekday % 7;

    // An open exception with an explicit window OVERRIDES the weekly rules for
    // that date (an extra clinic, a shifted morning). Otherwise use the rules.
    const windows: { start: number; end: number; slotMinutes: number }[] = [];

    if (exception && !exception.isClosed && exception.startLocal && exception.endLocal) {
      const start = parseLocalTime(exception.startLocal);
      const end = parseLocalTime(exception.endLocal);
      // Slot length comes from a rule for that weekday, else a 20-minute default.
      const slotMinutes = rules.find((r) => r.weekday === weekday)?.slotMinutes ?? 20;
      if (start !== null && end !== null && end > start) {
        windows.push({ start, end, slotMinutes });
      }
    } else {
      for (const rule of rules) {
        if (rule.weekday !== weekday) continue;

        // Rule must be in effect on this calendar date.
        const validFrom = DateTime.fromJSDate(rule.validFrom).setZone(timezone).startOf('day');
        if (day < validFrom) continue;
        if (rule.validUntil) {
          const validUntil = DateTime.fromJSDate(rule.validUntil).setZone(timezone).endOf('day');
          if (day > validUntil) continue;
        }

        const start = parseLocalTime(rule.startLocal);
        const end = parseLocalTime(rule.endLocal);
        if (start === null || end === null || end <= start) continue;
        if (rule.slotMinutes <= 0) continue;

        windows.push({ start, end, slotMinutes: rule.slotMinutes });
      }
    }

    for (const w of windows) {
      for (let offset = w.start; offset + w.slotMinutes <= w.end; offset += w.slotMinutes) {
        const startLocal = day.startOf('day').plus({ minutes: offset });
        const endLocal = startLocal.plus({ minutes: w.slotMinutes });

        // A DST spring-forward gap can make a wall-clock time non-existent.
        // Luxon flags it; skip rather than silently booking the wrong instant.
        if (!startLocal.isValid || !endLocal.isValid) continue;

        if (startLocal < earliest) continue; // lead time
        if (startLocal > latest) continue; // horizon

        const interval = Interval.fromDateTimes(startLocal, endLocal);
        if (!interval.isValid) continue;

        // Overlap, not equality: a rescheduled 40-min appointment must block
        // both 20-min slots it covers.
        if (bookedIntervals.some((b) => b.overlaps(interval))) continue;

        slots.push({ startAt: startLocal.toUTC().toJSDate(), endAt: endLocal.toUTC().toJSDate() });
      }
    }
  }

  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * Fetches the inputs and computes availability for one doctor+clinic.
 * Public data — no link required, since this drives the booking page a patient
 * sees before any relationship exists (§4).
 */
export async function getAvailability(params: {
  doctorId: string;
  clinicId: string;
  from: Date;
  to: Date;
  now?: Date;
}): Promise<Slot[]> {
  const { doctorId, clinicId, from, to, now = new Date() } = params;

  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: doctorId },
    select: { timezone: true, isPublished: true },
  });
  if (!doctor?.isPublished) return [];

  const [rules, exceptions, booked] = await Promise.all([
    prisma.availabilityRule.findMany({ where: { doctorId, clinicId } }),
    prisma.availabilityException.findMany({
      where: { doctorId, date: { gte: from, lte: to } },
    }),
    prisma.appointment.findMany({
      where: {
        clinicId,
        status: { in: ['REQUESTED', 'CONFIRMED'] },
        startAt: { lt: to },
        endAt: { gt: from },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);

  return computeSlots({
    rules,
    exceptions: exceptions.map((e) => ({
      date: DateTime.fromJSDate(e.date, { zone: 'utc' }).toISODate() ?? '',
      isClosed: e.isClosed,
      startLocal: e.startLocal,
      endLocal: e.endLocal,
    })),
    booked,
    timezone: doctor.timezone,
    from,
    to,
    now,
  });
}
