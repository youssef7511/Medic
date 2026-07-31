import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { computeSlots, type ComputeSlotsArgs } from './availability';

const TZ = 'Africa/Tunis';

// 2026-07-20 is a Monday. Luxon weekday 1 → schema weekday 1.
const MONDAY = '2026-07-20';

function baseArgs(overrides: Partial<ComputeSlotsArgs> = {}): ComputeSlotsArgs {
  return {
    rules: [
      {
        weekday: 1, // Monday
        startLocal: '09:00',
        endLocal: '11:00',
        slotMinutes: 30,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validUntil: null,
      },
    ],
    exceptions: [],
    booked: [],
    timezone: TZ,
    from: new Date(`${MONDAY}T00:00:00Z`),
    to: new Date(`${MONDAY}T23:59:59Z`),
    // Far enough back that lead time never interferes unless a test says so.
    now: new Date('2026-07-19T00:00:00Z'),
    ...overrides,
  };
}

function localTimes(slots: { startAt: Date }[]): string[] {
  return slots.map((s) => DateTime.fromJSDate(s.startAt).setZone(TZ).toFormat('HH:mm'));
}

test('expands a weekly rule into fixed-length slots', () => {
  const slots = computeSlots(baseArgs());
  assert.deepEqual(localTimes(slots), ['09:00', '09:30', '10:00', '10:30']);
});

test('never emits a partial slot that would overrun the window', () => {
  // 09:00–11:00 with 45-min slots fits 09:00 and 09:45; 10:30 would end 11:15.
  const slots = computeSlots(
    baseArgs({
      rules: [
        {
          weekday: 1,
          startLocal: '09:00',
          endLocal: '11:00',
          slotMinutes: 45,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validUntil: null,
        },
      ],
    }),
  );
  assert.deepEqual(localTimes(slots), ['09:00', '09:45']);
});

test('a closed exception wipes the day', () => {
  const slots = computeSlots(
    baseArgs({
      exceptions: [{ date: MONDAY, isClosed: true, startLocal: null, endLocal: null }],
    }),
  );
  assert.deepEqual(slots, []);
});

test('an open exception with a window overrides the weekly rule', () => {
  const slots = computeSlots(
    baseArgs({
      exceptions: [
        { date: MONDAY, isClosed: false, startLocal: '14:00', endLocal: '15:00' },
      ],
    }),
  );
  assert.deepEqual(localTimes(slots), ['14:00', '14:30']);
});

test('booked appointments remove exactly the slots they overlap', () => {
  const slots = computeSlots(
    baseArgs({
      booked: [
        {
          startAt: DateTime.fromISO(`${MONDAY}T09:30`, { zone: TZ }).toJSDate(),
          endAt: DateTime.fromISO(`${MONDAY}T10:00`, { zone: TZ }).toJSDate(),
        },
      ],
    }),
  );
  assert.deepEqual(localTimes(slots), ['09:00', '10:00', '10:30']);
});

test('a long appointment blocks every slot it covers, not just its start', () => {
  // 09:15–10:15 straddles the 09:00, 09:30 and 10:00 slots.
  const slots = computeSlots(
    baseArgs({
      booked: [
        {
          startAt: DateTime.fromISO(`${MONDAY}T09:15`, { zone: TZ }).toJSDate(),
          endAt: DateTime.fromISO(`${MONDAY}T10:15`, { zone: TZ }).toJSDate(),
        },
      ],
    }),
  );
  assert.deepEqual(localTimes(slots), ['10:30']);
});

test('adjacent bookings do not block each other (half-open intervals)', () => {
  // An appointment ending exactly at 09:30 must leave the 09:30 slot bookable.
  const slots = computeSlots(
    baseArgs({
      booked: [
        {
          startAt: DateTime.fromISO(`${MONDAY}T09:00`, { zone: TZ }).toJSDate(),
          endAt: DateTime.fromISO(`${MONDAY}T09:30`, { zone: TZ }).toJSDate(),
        },
      ],
    }),
  );
  assert.ok(localTimes(slots).includes('09:30'));
});

test('lead time hides slots that are too soon', () => {
  // "Now" is 08:00 local on the day itself; a 120-min lead hides 09:00/09:30.
  const slots = computeSlots(
    baseArgs({
      now: DateTime.fromISO(`${MONDAY}T08:00`, { zone: TZ }).toJSDate(),
      leadTimeMinutes: 120,
    }),
  );
  assert.deepEqual(localTimes(slots), ['10:00', '10:30']);
});

test('horizon hides slots too far out', () => {
  const slots = computeSlots(baseArgs({ horizonDays: 0 }));
  assert.deepEqual(slots, []);
});

test('rules outside their validity range do not apply', () => {
  const expired = computeSlots(
    baseArgs({
      rules: [
        {
          weekday: 1,
          startLocal: '09:00',
          endLocal: '11:00',
          slotMinutes: 30,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validUntil: new Date('2026-06-01T00:00:00Z'), // ended before MONDAY
        },
      ],
    }),
  );
  assert.deepEqual(expired, []);

  const notYet = computeSlots(
    baseArgs({
      rules: [
        {
          weekday: 1,
          startLocal: '09:00',
          endLocal: '11:00',
          slotMinutes: 30,
          validFrom: new Date('2027-01-01T00:00:00Z'), // starts after MONDAY
          validUntil: null,
        },
      ],
    }),
  );
  assert.deepEqual(notYet, []);
});

test('a rule only fires on its own weekday', () => {
  const slots = computeSlots(
    baseArgs({
      rules: [
        {
          weekday: 3, // Wednesday, but the window is a Monday
          startLocal: '09:00',
          endLocal: '11:00',
          slotMinutes: 30,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validUntil: null,
        },
      ],
    }),
  );
  assert.deepEqual(slots, []);
});

test('Sunday maps to weekday 0 (schema convention, not Luxon 7)', () => {
  const sunday = '2026-07-19';
  const slots = computeSlots(
    baseArgs({
      rules: [
        {
          weekday: 0,
          startLocal: '09:00',
          endLocal: '10:00',
          slotMinutes: 30,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validUntil: null,
        },
      ],
      from: new Date(`${sunday}T00:00:00Z`),
      to: new Date(`${sunday}T23:59:59Z`),
      now: new Date('2026-07-18T00:00:00Z'),
    }),
  );
  assert.deepEqual(localTimes(slots), ['09:00', '09:30']);
});

test('malformed rule times are skipped rather than producing junk slots', () => {
  const slots = computeSlots(
    baseArgs({
      rules: [
        {
          weekday: 1,
          startLocal: '25:00', // invalid hour
          endLocal: '11:00',
          slotMinutes: 30,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validUntil: null,
        },
        {
          weekday: 1,
          startLocal: '11:00',
          endLocal: '10:00', // end before start
          slotMinutes: 30,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validUntil: null,
        },
      ],
    }),
  );
  assert.deepEqual(slots, []);
});

test('slots are emitted in chronological order', () => {
  const slots = computeSlots(
    baseArgs({
      rules: [
        {
          weekday: 1,
          startLocal: '14:00',
          endLocal: '15:00',
          slotMinutes: 30,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validUntil: null,
        },
        {
          weekday: 1,
          startLocal: '09:00',
          endLocal: '10:00',
          slotMinutes: 30,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validUntil: null,
        },
      ],
    }),
  );
  assert.deepEqual(localTimes(slots), ['09:00', '09:30', '14:00', '14:30']);
});

test('stores UTC instants that match the doctor local wall clock', () => {
  // Africa/Tunis is UTC+1 year-round; 09:00 local = 08:00Z.
  const slots = computeSlots(baseArgs());
  assert.equal(slots[0]?.startAt.toISOString(), '2026-07-20T08:00:00.000Z');
});

test('Morocco DST shift is handled via the IANA zone, not a fixed offset', () => {
  // Africa/Casablanca sits at UTC+1, but drops to UTC+0 for Ramadan. In
  // mid-March 2026 the zone is UTC+0, so 09:00 local = 09:00Z — a hardcoded
  // +1 offset would silently book everyone an hour early.
  const marchMonday = '2026-03-16';
  const slots = computeSlots({
    rules: [
      {
        weekday: 1,
        startLocal: '09:00',
        endLocal: '10:00',
        slotMinutes: 60,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validUntil: null,
      },
    ],
    exceptions: [],
    booked: [],
    timezone: 'Africa/Casablanca',
    from: new Date(`${marchMonday}T00:00:00Z`),
    to: new Date(`${marchMonday}T23:59:59Z`),
    now: new Date('2026-03-15T00:00:00Z'),
  });

  const expected = DateTime.fromISO(`${marchMonday}T09:00`, {
    zone: 'Africa/Casablanca',
  }).toUTC().toISO();
  assert.equal(slots.length, 1);
  assert.equal(DateTime.fromJSDate(slots[0]!.startAt).toUTC().toISO(), expected);
});
