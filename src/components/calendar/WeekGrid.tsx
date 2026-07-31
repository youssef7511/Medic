'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { layoutEvents, toPercent, type TimedEvent } from '@/lib/calendar/layout';
import type { AvailabilityBand, CalendarEvent } from '@/lib/calendar/queries';
import type { WeekDay } from '@/lib/calendar/layout';

/**
 * The week agenda: a time axis down the inline-start edge and seven day
 * columns.
 *
 * Layout notes that matter:
 *  - Positioning is `top`/`height` percentages inside a relatively-positioned
 *    column, and `inset-inline-start`/`width` percentages for overlap lanes.
 *    Using the INLINE axis (not `left`) means the whole grid mirrors correctly
 *    in Arabic with no RTL-specific styles (§9).
 *  - Day columns are a CSS grid, so column order flips automatically under
 *    `dir="rtl"` — Monday lands on the right in Arabic, which is what a native
 *    reader expects.
 *  - The grid scrolls horizontally on narrow screens rather than letting the
 *    page body scroll.
 */

/** Row height. 56px/hour makes a 30-minute block 28px — one comfortable line. */
const PX_PER_HOUR = 56;
/** Below this, a block only has room for a single line of text. */
const COMPACT_BLOCK_PX = 38;

const STATUS_STYLES: Record<string, string> = {
  REQUESTED: 'bg-amber-100 border-amber-300 text-amber-900',
  CONFIRMED: 'bg-brand-100 border-brand-500 text-brand-700',
  COMPLETED: 'bg-gray-100 border-gray-300 text-gray-600',
  NO_SHOW: 'bg-red-100 border-red-300 text-red-800',
};

interface Props {
  days: WeekDay[];
  events: CalendarEvent[];
  bands: AvailabilityBand[];
  closedDates: string[];
  bounds: { startHour: number; endHour: number };
  timezone: string;
  locale: string;
  onSelect?: (eventId: string) => void;
}

export function WeekGrid({
  days,
  events,
  bands,
  closedDates,
  bounds,
  timezone,
  locale,
  onSelect,
}: Props) {
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = bounds.startHour; h <= bounds.endHour; h++) out.push(h);
    return out;
  }, [bounds.startHour, bounds.endHour]);

  // Group events per day column, then pack overlaps within that day only.
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      // Bucket by the doctor-local calendar date, not the UTC date.
      const iso = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(event.startAt);
      const list = map.get(iso) ?? [];
      list.push(event);
      map.set(iso, list);
    }
    return map;
  }, [events, timezone]);

  const closed = useMemo(() => new Set(closedDates), [closedDates]);
  const ar = locale === 'ar';

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        {/* Day headers */}
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-gray-200">
          <div />
          {days.map((day) => (
            <div
              key={day.isoDate}
              className={cn(
                'border-s border-gray-100 px-2 py-2 text-center',
                day.isToday && 'bg-brand-50',
              )}
            >
              <p
                className={cn(
                  'text-sm font-medium capitalize',
                  day.isToday ? 'text-brand-700' : 'text-gray-700',
                )}
              >
                {day.label}
              </p>
              {closed.has(day.isoDate) && (
                <p className="text-[11px] text-gray-400">{ar ? 'مغلق' : 'Fermé'}</p>
              )}
            </div>
          ))}
        </div>

        {/* Time grid */}
        <div className="relative grid grid-cols-[3.5rem_repeat(7,1fr)]">
          {/* Hour axis — labels sit just below their own hour line, at the same
              percentage as the line opposite, so the two can't drift apart.
              The final boundary hour is skipped: it has no line either, and a
              label at 100% would be clipped by the scroll container. */}
          <div className="relative">
            {hours.slice(0, -1).map((h) => (
              <span
                key={h}
                className="absolute end-2 text-[11px] tabular-nums text-gray-400"
                style={{
                  top: `calc(${
                    ((h - bounds.startHour) / (bounds.endHour - bounds.startHour)) * 100
                  }% + 2px)`,
                }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {days.map((day) => {
            const dayEvents = eventsByDate.get(day.isoDate) ?? [];
            const positioned = layoutEvents(dayEvents as TimedEvent[], timezone);
            const dayBands = bands.filter((b) => b.weekday === day.weekday);
            const isClosed = closed.has(day.isoDate);

            return (
              <div
                key={day.isoDate}
                className={cn(
                  'relative border-s border-gray-100',
                  day.isToday && 'bg-brand-50/40',
                  isClosed && 'bg-gray-50',
                )}
                style={{ minHeight: `${(bounds.endHour - bounds.startHour) * PX_PER_HOUR}px` }}
              >
                {/* Hour lines */}
                {hours.slice(0, -1).map((h) => (
                  <div
                    key={h}
                    className="absolute border-b border-gray-100"
                    style={{
                      top: `${((h - bounds.startHour) / (bounds.endHour - bounds.startHour)) * 100}%`,
                      insetInlineStart: 0,
                      insetInlineEnd: 0,
                    }}
                  />
                ))}

                {/* Working-hours bands: the doctor sees at a glance when they're
                    open, so an appointment outside the band is visibly odd. */}
                {!isClosed &&
                  dayBands.map((band, i) => {
                    const { top, height } = toPercent(
                      { startMinutes: band.startMinutes, endMinutes: band.endMinutes },
                      bounds,
                    );
                    return (
                      <div
                        key={`${band.startMinutes}-${i}`}
                        aria-hidden
                        className="absolute bg-brand-50"
                        style={{
                          top: `${top}%`,
                          height: `${height}%`,
                          insetInlineStart: 0,
                          insetInlineEnd: 0,
                        }}
                      />
                    );
                  })}

                {/* Appointments */}
                {positioned.map((p) => {
                  const { top, height } = toPercent(p, bounds);
                  const event = p.event as CalendarEvent;
                  const widthPct = 100 / p.laneCount;

                  // A 30-minute block is ~28px: enough for one line, not two.
                  // Stacking regardless would clip the patient's name, which is
                  // the one thing the doctor actually needs to read.
                  const blockPx = ((p.endMinutes - p.startMinutes) / 60) * PX_PER_HOUR;
                  const compact = blockPx < COMPACT_BLOCK_PX;

                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onSelect?.(event.id)}
                      title={`${event.timeLabel} · ${event.patientName} · ${event.clinicName}`}
                      className={cn(
                        'absolute flex overflow-hidden rounded border px-1.5 text-start text-[11px] leading-tight shadow-sm transition hover:z-10 hover:shadow',
                        // Short blocks put time and name on one line; taller
                        // ones stack them. Either way it's flex, so the gap is
                        // explicit rather than depending on inline whitespace.
                        compact ? 'items-center gap-1.5 py-0' : 'flex-col gap-0.5 py-1',
                        STATUS_STYLES[event.status] ?? STATUS_STYLES.COMPLETED,
                      )}
                      style={{
                        top: `${top}%`,
                        height: `${height}%`,
                        insetInlineStart: `${p.lane * widthPct}%`,
                        width: `calc(${widthPct}% - 2px)`,
                      }}
                    >
                      <span className="shrink-0 font-medium tabular-nums">{event.timeLabel}</span>
                      <span className="truncate">{event.patientName}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
