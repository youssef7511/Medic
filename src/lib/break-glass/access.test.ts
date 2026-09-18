import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BREAK_GLASS_MINUTES,
  MIN_BREAK_GLASS_MINUTES,
  BreakGlassValidationError,
  validateBreakGlassRequest,
} from './access';
import { renderBreakGlassSms } from '@/lib/notifications/security';

test('break-glass duration is deliberately narrow', () => {
  assert.equal(MIN_BREAK_GLASS_MINUTES, 5);
  assert.equal(MAX_BREAK_GLASS_MINUTES, 30);
});

test('patient notification never includes the admin reason or clinical content', () => {
  const fr = renderBreakGlassSms('fr');
  const ar = renderBreakGlassSms('ar');
  assert.match(fr, /urgence/);
  assert.match(ar, /طارئ/);
  assert.doesNotMatch(fr, /diagnostic|cancer|raison/i);
});

test('validation error has a stable non-sensitive code', () => {
  const error = new BreakGlassValidationError('reason_length');
  assert.equal(error.code, 'reason_length');
});

test('break-glass requires a substantive reason, bounded duration and fresh TOTP shape', () => {
  assert.equal(
    validateBreakGlassRequest('Urgent patient safety investigation', 15, '123456'),
    'Urgent patient safety investigation',
  );
  assert.throws(
    () => validateBreakGlassRequest('too short', 15, '123456'),
    (error: BreakGlassValidationError) => error.code === 'reason_length',
  );
  assert.throws(
    () => validateBreakGlassRequest('Urgent patient safety investigation', 60, '123456'),
    (error: BreakGlassValidationError) => error.code === 'duration',
  );
  assert.throws(
    () => validateBreakGlassRequest('Urgent patient safety investigation', 15, 'abcdef'),
    (error: BreakGlassValidationError) => error.code === 'totp',
  );
});
