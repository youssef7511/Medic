import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { rolesRequireMfa } from './totp';

test('only active privileged roles require MFA', () => {
  const now = new Date('2026-09-18T12:00:00Z');
  assert.equal(rolesRequireMfa([{ role: Role.PATIENT }], now), false);
  assert.equal(rolesRequireMfa([{ role: Role.DOCTOR, expiresAt: null }], now), true);
  assert.equal(
    rolesRequireMfa([{ role: Role.SUPPORT_ADMIN, expiresAt: new Date('2026-09-18T11:00:00Z') }], now),
    false,
  );
});
