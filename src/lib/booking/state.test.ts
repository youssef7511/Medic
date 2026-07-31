import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppointmentStatus } from '@prisma/client';
import { canTransition, holdsSlot, isTerminal, canMarkNoShow, assertTransition } from './state';

const { REQUESTED, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW } = AppointmentStatus;

test('the legal transitions from §6 are allowed', () => {
  assert.ok(canTransition(REQUESTED, CONFIRMED));
  assert.ok(canTransition(REQUESTED, CANCELLED));
  assert.ok(canTransition(CONFIRMED, COMPLETED));
  assert.ok(canTransition(CONFIRMED, CANCELLED));
  assert.ok(canTransition(CONFIRMED, NO_SHOW));
});

test('terminal states never transition again', () => {
  for (const terminal of [CANCELLED, COMPLETED, NO_SHOW]) {
    assert.ok(isTerminal(terminal), `${terminal} should be terminal`);
    for (const to of [REQUESTED, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW]) {
      assert.equal(canTransition(terminal, to), false, `${terminal} → ${to} must be rejected`);
    }
  }
});

test('an unconfirmed appointment cannot skip straight to completed or no-show', () => {
  // A REQUESTED appointment the doctor never accepted did not "happen".
  assert.equal(canTransition(REQUESTED, COMPLETED), false);
  assert.equal(canTransition(REQUESTED, NO_SHOW), false);
});

test('an appointment cannot be un-confirmed back to requested', () => {
  assert.equal(canTransition(CONFIRMED, REQUESTED), false);
});

test('assertTransition throws on an illegal move', () => {
  assert.throws(() => assertTransition(CANCELLED, CONFIRMED), /Cannot move an appointment/);
});

test('only REQUESTED and CONFIRMED hold a slot', () => {
  // Must match the WHERE clause on the exclusion constraint in 001_hardening.sql,
  // or cancelled appointments would keep blocking their slot.
  assert.ok(holdsSlot(REQUESTED));
  assert.ok(holdsSlot(CONFIRMED));
  assert.equal(holdsSlot(CANCELLED), false);
  assert.equal(holdsSlot(COMPLETED), false);
  assert.equal(holdsSlot(NO_SHOW), false);
});

test('a future appointment cannot be marked no-show', () => {
  const now = new Date('2026-07-20T10:00:00Z');
  const future = new Date('2026-07-20T15:00:00Z');
  // Marking a future booking absent would also feed the §13.4 gating unfairly.
  assert.equal(canMarkNoShow(CONFIRMED, future, now), false);
});

test('a started appointment can be marked no-show', () => {
  const now = new Date('2026-07-20T15:30:00Z');
  const started = new Date('2026-07-20T15:00:00Z');
  assert.ok(canMarkNoShow(CONFIRMED, started, now));
});

test('no-show still respects the state machine', () => {
  const now = new Date('2026-07-20T15:30:00Z');
  const started = new Date('2026-07-20T15:00:00Z');
  // Past, but never confirmed → not a no-show.
  assert.equal(canMarkNoShow(REQUESTED, started, now), false);
  assert.equal(canMarkNoShow(CANCELLED, started, now), false);
});
