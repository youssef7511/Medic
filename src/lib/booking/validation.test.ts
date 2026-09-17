import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalTime, validateRule, type RuleDraft } from './validation';

const valid: RuleDraft = {
  weekday: 1,
  startLocal: '09:00',
  endLocal: '12:00',
  slotMinutes: 30,
};

test('parseLocalTime accepts HH:MM and rejects nonsense', () => {
  assert.equal(parseLocalTime('09:00'), 540);
  assert.equal(parseLocalTime('9:05'), 545);
  assert.equal(parseLocalTime('23:59'), 1439);
  assert.equal(parseLocalTime('24:00'), null);
  assert.equal(parseLocalTime('09:60'), null);
  assert.equal(parseLocalTime('nine'), null);
  assert.equal(parseLocalTime(''), null);
});

test('a well-formed rule passes', () => {
  assert.deepEqual(validateRule(valid), []);
});

test('rejects an out-of-range weekday', () => {
  assert.ok(validateRule({ ...valid, weekday: 7 }).includes('invalid_weekday'));
  assert.ok(validateRule({ ...valid, weekday: -1 }).includes('invalid_weekday'));
});

test('rejects an end at or before the start', () => {
  assert.ok(validateRule({ ...valid, endLocal: '09:00' }).includes('end_before_start'));
  assert.ok(validateRule({ ...valid, endLocal: '08:00' }).includes('end_before_start'));
});

test('rejects an implausible slot length', () => {
  assert.ok(validateRule({ ...valid, slotMinutes: 0 }).includes('invalid_slot_length'));
  assert.ok(validateRule({ ...valid, slotMinutes: 999 }).includes('invalid_slot_length'));
  assert.ok(validateRule({ ...valid, slotMinutes: 12.5 }).includes('invalid_slot_length'));
});

test('rejects a slot longer than its own window', () => {
  // 60-minute slots in a 30-minute window would generate nothing bookable.
  const errors = validateRule({
    weekday: 1,
    startLocal: '09:00',
    endLocal: '09:30',
    slotMinutes: 60,
  });
  assert.ok(errors.includes('slot_longer_than_window'));
});

test('a slot exactly filling the window is allowed', () => {
  assert.deepEqual(
    validateRule({ weekday: 1, startLocal: '09:00', endLocal: '10:00', slotMinutes: 60 }),
    [],
  );
});

test('detects overlap with an existing rule on the same weekday', () => {
  const existing = [{ ...valid, id: 'r1' }];
  const errors = validateRule(
    { weekday: 1, startLocal: '11:00', endLocal: '14:00', slotMinutes: 30 },
    existing,
  );
  assert.ok(errors.includes('overlaps_existing'));
});

test('touching windows do not count as overlapping', () => {
  // 09:00–12:00 followed by 12:00–15:00 is a legitimate split day.
  const existing = [{ ...valid, id: 'r1' }];
  const errors = validateRule(
    { weekday: 1, startLocal: '12:00', endLocal: '15:00', slotMinutes: 30 },
    existing,
  );
  assert.deepEqual(errors, []);
});

test('the same times on a different weekday are fine', () => {
  const existing = [{ ...valid, id: 'r1' }];
  assert.deepEqual(validateRule({ ...valid, weekday: 2 }, existing), []);
});

test('a rule being edited does not clash with itself', () => {
  const existing = [{ ...valid, id: 'r1' }];
  // Editing r1 to shift slightly must not report an overlap against r1.
  const errors = validateRule({ ...valid, endLocal: '13:00' }, existing, 'r1');
  assert.deepEqual(errors, []);
});

test('an existing rule fully containing the new one is caught', () => {
  const existing = [{ weekday: 1, startLocal: '08:00', endLocal: '18:00', slotMinutes: 30, id: 'r1' }];
  const errors = validateRule(
    { weekday: 1, startLocal: '10:00', endLocal: '11:00', slotMinutes: 30 },
    existing,
  );
  assert.ok(errors.includes('overlaps_existing'));
});

test('invalid times short-circuit and do not cascade', () => {
  const errors = validateRule({ ...valid, startLocal: 'oops' });
  assert.deepEqual(errors, ['invalid_time']);
});
