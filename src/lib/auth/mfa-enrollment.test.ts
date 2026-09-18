import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMfaEnrollmentToken,
  hashMfaEnrollmentToken,
  mfaEnrollmentExpiry,
  MFA_ENROLLMENT_TOKEN_TTL_MS,
} from './mfa-enrollment';

test('enrollment tokens carry at least 256 bits and only hashes are persisted', () => {
  const token = generateMfaEnrollmentToken();
  assert.ok(token.length >= 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(hashMfaEnrollmentToken(token).length, 64);
  assert.notEqual(hashMfaEnrollmentToken(token), token);
});

test('enrollment tokens expire after the fixed short-lived window', () => {
  const now = new Date('2026-09-18T12:00:00Z');
  assert.equal(mfaEnrollmentExpiry(now).getTime() - now.getTime(), MFA_ENROLLMENT_TOKEN_TTL_MS);
});
