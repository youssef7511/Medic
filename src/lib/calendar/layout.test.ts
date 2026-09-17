import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  buildWeek,
  computeDayBounds,
  layoutEvents,
  minutesFromMidnight,
  shiftWeek,
  toPercent,
} from './layout';

const TZ = 'Africa/Tunis';

function ev(id: string, start: string, end: string) {
  return {
    id,
    startAt: DateTime.fromISO(`2026-07-20T${start}`, { zone: TZ }).toJSDate(),
    endAt: DateTime.fromISO(`2026-07-20T${end}`, { zone: TZ }).toJSDate(),
  };
}

function byId(positioned: ReturnType<typeof layoutEvents>) {
  return Object.fromEntries(positioned.map((p) => [p.event.id, p]));
}

// ------------------------------------------------------------------ week grid

test('buildWeek returns 7 days starting Monday', () => {
  // 2026-07-22 is a Wednesday.
  const week = buildWeek({
    anchor: new Date('2026-07-22T10:00:00Z'),
    timezone: TZ,
    locale: 'fr',
  });

  assert.equal(week.length, 7);
  assert.equal(week[0]?.isoDate, '2026-07-20'); // Monday
  assert.equal(week[6]?.isoDate, '2026-07-26'); // Sunday
});

test('buildWeek maps Sunday to weekday 0 (schema convention)', () => {
  const week = buildWeek({
    anchor: new Date('2026-07-22T10:00:00Z'),
    timezone: TZ,
    locale: 'fr',
  });
  assert.equal(week[6]?.weekday, 0); // Sunday
  assert.equal(week[0]?.weekday, 1); // Monday
});

test('buildWeek marks today only on the actual current day', () => {
  const week = buildWeek({
    anchor: new Date('2026-07-22T10:00:00Z'),
    timezone: TZ,
    locale: 'fr',
    now: new Date('2026-07-22T10:00:00Z'),
  });
  assert.equal(week.filter((d) => d.isToday).length, 1);
  assert.equal(week.find((d) => d.isToday)?.isoDate, '2026-07-22');
});

test('shiftWeek moves a whole week in each direction', () => {
  const anchor = new Date('2026-07-22T10:00:00Z');
  const next = shiftWeek(anchor, TZ, 1);
  const prev = shiftWeek(anchor, TZ, -1);
  assert.equal(DateTime.fromJSDate(next).setZone(TZ).toISODate(), '2026-07-29');
  assert.equal(DateTime.fromJSDate(prev).setZone(TZ).toISODate(), '2026-07-15');
});

// -------------------------------------------------------------- time mapping

test('minutesFromMidnight uses the doctor zone, not the server zone', () => {
  // 08:00Z is 09:00 in Africa/Tunis (UTC+1).
  const instant = new Date('2026-07-20T08:00:00Z');
  assert.equal(minutesFromMidnight(instant, TZ), 9 * 60);
});

// ------------------------------------------------------------ overlap packing

test('non-overlapping events all sit in a single full-width lane', () => {
  const positioned = layoutEvents(
    [ev('a', '09:00', '09:30'), ev('b', '10:00', '10:30')],
    TZ,
  );
  assert.ok(positioned.every((p) => p.laneCount === 1 && p.lane === 0));
});

test('two overlapping events split into two lanes', () => {
  const positioned = byId(layoutEvents([ev('a', '09:00', '10:00'), ev('b', '09:30', '10:30')], TZ));
  assert.equal(positioned.a?.laneCount, 2);
  assert.equal(positioned.b?.laneCount, 2);
  assert.notEqual(positioned.a?.lane, positioned.b?.lane);
});

test('an isolated event is NOT squashed by an overlap elsewhere in the day', () => {
  // The classic bug: packing lanes globally would make 'solo' half-width.
  const positioned = byId(
    layoutEvents(
      [ev('a', '09:00', '10:00'), ev('b', '09:30', '10:30'), ev('solo', '15:00', '15:30')],
      TZ,
    ),
  );
  assert.equal(positioned.a?.laneCount, 2);
  assert.equal(positioned.solo?.laneCount, 1, 'isolated event must keep full width');
});

test('transitive overlap forms one cluster (A–B, B–C, but not A–C)', () => {
  const positioned = byId(
    layoutEvents(
      [ev('a', '09:00', '10:00'), ev('b', '09:45', '10:45'), ev('c', '10:30', '11:30')],
      TZ,
    ),
  );
  // All three share horizontal space even though A and C never touch.
  assert.equal(positioned.a?.laneCount, 2);
  assert.equal(positioned.b?.laneCount, 2);
  assert.equal(positioned.c?.laneCount, 2);
  // A and C can reuse the same lane since they don't overlap.
  assert.equal(positioned.a?.lane, positioned.c?.lane);
});

test('back-to-back events reuse the same lane (half-open intervals)', () => {
  const positioned = byId(layoutEvents([ev('a', '09:00', '09:30'), ev('b', '09:30', '10:00')], TZ));
  assert.equal(positioned.a?.laneCount, 1);
  assert.equal(positioned.b?.lane, 0);
});

test('three mutually overlapping events need three lanes', () => {
  const positioned = layoutEvents(
    [ev('a', '09:00', '11:00'), ev('b', '09:30', '11:00'), ev('c', '10:00', '11:00')],
    TZ,
  );
  assert.ok(positioned.every((p) => p.laneCount === 3));
  assert.deepEqual(positioned.map((p) => p.lane).sort(), [0, 1, 2]);
});

test('every event is returned exactly once', () => {
  const input = [ev('a', '09:00', '10:00'), ev('b', '09:30', '10:30'), ev('c', '14:00', '14:30')];
  const positioned = layoutEvents(input, TZ);
  assert.equal(positioned.length, 3);
  assert.deepEqual(positioned.map((p) => p.event.id).sort(), ['a', 'b', 'c']);
});

// ---------------------------------------------------------------- day bounds

test('day bounds hug actual availability with an hour of padding', () => {
  const bounds = computeDayBounds([{ startMinutes: 9 * 60, endMinutes: 12 * 60 }]);
  assert.deepEqual(bounds, { startHour: 8, endHour: 13 });
});

test('day bounds fall back when there is nothing to show', () => {
  assert.deepEqual(computeDayBounds([]), { startHour: 8, endHour: 18 });
});

test('day bounds never escape the day', () => {
  const bounds = computeDayBounds([{ startMinutes: 0, endMinutes: 24 * 60 }]);
  assert.equal(bounds.startHour, 0);
  assert.equal(bounds.endHour, 24);
});

// ------------------------------------------------------------------ geometry

test('toPercent places an event proportionally inside the window', () => {
  const bounds = { startHour: 8, endHour: 18 }; // 600 minutes
  const { top, height } = toPercent({ startMinutes: 9 * 60, endMinutes: 10 * 60 }, bounds);
  assert.equal(top, 10); // 60 / 600
  assert.equal(height, 10);
});

test('very short slots keep a minimum tappable height', () => {
  const bounds = { startHour: 8, endHour: 18 };
  const { height } = toPercent({ startMinutes: 9 * 60, endMinutes: 9 * 60 + 5 }, bounds);
  assert.ok(height >= 1.5);
});
