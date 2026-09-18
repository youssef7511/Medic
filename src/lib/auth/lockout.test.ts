import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoginLocked, lockoutDurationMs, MAX_LOCKOUT_MS } from './lockout';

test('lockout starts on the fifth failure and backs off exponentially', () => {
  assert.equal(lockoutDurationMs(4), 0);
  assert.equal(lockoutDurationMs(5), 30_000);
  assert.equal(lockoutDurationMs(6), 60_000);
  assert.equal(lockoutDurationMs(7), 120_000);
});

test('lockout duration is capped at thirty minutes', () => {
  assert.equal(lockoutDurationMs(100), MAX_LOCKOUT_MS);
});

test('expired lockouts do not block login', () => {
  const now = new Date('2026-09-18T12:00:00Z');
  assert.equal(isLoginLocked(new Date('2026-09-18T12:00:01Z'), now), true);
  assert.equal(isLoginLocked(new Date('2026-09-18T11:59:59Z'), now), false);
  assert.equal(isLoginLocked(null, now), false);
});
