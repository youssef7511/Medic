import { DateTime } from 'luxon';

/**
 * Agenda layout maths, kept free of React so the fiddly parts — overlap
 * packing, day bounds, DST-safe day starts — are unit-testable.
 *
 * Positions are emitted as percentages, never pixels: the grid is then purely
 * CSS-driven and the same numbers work at any row height, and (because we
 * position on the inline axis with logical properties) unchanged under RTL.
 */

export const WEEK_STARTS_ON = 1; // Monday. Maghreb business weeks run Mon–Sat.

export interface WeekDay {
  /** "2026-07-20" in the doctor's zone. */
  isoDate: string;
  /** Localized, e.g. "lun. 20". */
  label: string;
  weekday: number; // 0 = Sunday … 6 = Saturday (schema convention)
  isToday: boolean;
}

/** Builds the 7 day-columns for the week containing `anchor`. */
export function buildWeek(args: {
  anchor: Date;
  timezone: string;
  locale: string;
  now?: Date;
}): WeekDay[] {
  const { anchor, timezone, locale, now = new Date() } = args;

  const anchorDt = DateTime.fromJSDate(anchor).setZone(timezone).setLocale(locale);
  // Luxon weeks start Monday; shift if we ever change WEEK_STARTS_ON.
  const start = anchorDt.startOf('week').plus({ days: WEEK_STARTS_ON - 1 });
  const todayIso = DateTime.fromJSDate(now).setZone(timezone).toISODate();

  return Array.from({ length: 7 }, (_, i) => {
    const day = start.plus({ days: i });
    return {
      isoDate: day.toISODate() ?? '',
      label: day.toFormat('ccc d'),
      weekday: day.weekday % 7,
      isToday: day.toISODate() === todayIso,
    };
  });
}

export function shiftWeek(anchor: Date, timezone: string, direction: -1 | 1): Date {
  return DateTime.fromJSDate(anchor)
    .setZone(timezone)
    .plus({ weeks: direction })
    .toJSDate();
}

export interface TimedEvent {
  id: string;
  startAt: Date;
  endAt: Date;
}

export interface PositionedEvent<T extends TimedEvent> {
  event: T;
  /** Minutes from midnight, in the doctor's zone. */
  startMinutes: number;
  endMinutes: number;
  /** Column index within its overlap cluster, and how many columns that cluster needs. */
  lane: number;
  laneCount: number;
}

/** Minutes from local midnight for an instant, in a given zone. */
export function minutesFromMidnight(instant: Date, timezone: string): number {
  const dt = DateTime.fromJSDate(instant).setZone(timezone);
  return dt.hour * 60 + dt.minute;
}

/**
 * Packs overlapping events into side-by-side lanes (the Google-Calendar
 * behaviour).
 *
 * Two passes. First, group events into *clusters* of transitively overlapping
 * events — A overlaps B and B overlaps C puts all three in one cluster even if
 * A and C don't touch, because they must still share horizontal space. Then
 * assign each event the first lane that's free at its start time.
 *
 * Getting the cluster step wrong is the classic bug here: packing lanes
 * globally makes a single 08:00 appointment squash the entire day into half
 * width.
 */
export function layoutEvents<T extends TimedEvent>(
  events: T[],
  timezone: string,
): PositionedEvent<T>[] {
  const items = events
    .map((event) => ({
      event,
      startMinutes: minutesFromMidnight(event.startAt, timezone),
      endMinutes: minutesFromMidnight(event.endAt, timezone),
    }))
    // An appointment running past midnight would read as endMinutes < start;
    // clamp to end-of-day so it still renders as a block rather than vanishing.
    .map((i) => (i.endMinutes <= i.startMinutes ? { ...i, endMinutes: 24 * 60 } : i))
    .sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes);

  const out: PositionedEvent<T>[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;

    // Greedy lane assignment within the cluster.
    const laneEnds: number[] = [];
    const assigned = cluster.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.startMinutes);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endMinutes);
      } else {
        laneEnds[lane] = item.endMinutes;
      }
      return { ...item, lane };
    });

    for (const item of assigned) {
      out.push({ ...item, laneCount: laneEnds.length });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of items) {
    if (cluster.length > 0 && item.startMinutes >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  flush();

  return out;
}

export interface DayBounds {
  startHour: number;
  endHour: number;
}

/**
 * Picks the visible time window.
 *
 * Rendering a fixed 00:00–24:00 grid wastes most of the screen for a doctor who
 * works 09:00–17:00, and makes every appointment a thin sliver. So the window
 * is derived from actual availability and events, padded by an hour, and only
 * then clamped to the day.
 */
export function computeDayBounds(
  windows: { startMinutes: number; endMinutes: number }[],
  fallback: DayBounds = { startHour: 8, endHour: 18 },
): DayBounds {
  if (windows.length === 0) return fallback;

  const earliest = Math.min(...windows.map((w) => w.startMinutes));
  const latest = Math.max(...windows.map((w) => w.endMinutes));

  return {
    startHour: Math.max(0, Math.floor(earliest / 60) - 1),
    endHour: Math.min(24, Math.ceil(latest / 60) + 1),
  };
}

/** Converts an event's minutes into top/height percentages within the grid. */
export function toPercent(
  positioned: { startMinutes: number; endMinutes: number },
  bounds: DayBounds,
): { top: number; height: number } {
  const spanMinutes = (bounds.endHour - bounds.startHour) * 60;
  if (spanMinutes <= 0) return { top: 0, height: 0 };

  const offset = positioned.startMinutes - bounds.startHour * 60;
  const duration = positioned.endMinutes - positioned.startMinutes;

  return {
    top: (offset / spanMinutes) * 100,
    height: Math.max((duration / spanMinutes) * 100, 1.5), // keep short slots tappable
  };
}
