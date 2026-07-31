import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { roleGrants } from './permissions';

// These encode invariants from §5 that must never silently regress.

test('deny by default: a permission not in a role set is denied', () => {
  // DOCTOR_STAFF has no clinical permissions at all.
  assert.equal(roleGrants(Role.DOCTOR_STAFF, 'note:read'), false);
  assert.equal(roleGrants(Role.DOCTOR_STAFF, 'document:issue'), false);
  assert.equal(roleGrants(Role.DOCTOR_STAFF, 'message:read:clinical'), false);
});

test('SUPER_ADMIN cannot read clinical notes or messages (§5)', () => {
  assert.equal(roleGrants(Role.SUPER_ADMIN, 'note:read'), false);
  assert.equal(roleGrants(Role.SUPER_ADMIN, 'note:write'), false);
  assert.equal(roleGrants(Role.SUPER_ADMIN, 'message:read:clinical'), false);
});

test('SUPPORT_ADMIN cannot touch clinical content or assign roles', () => {
  assert.equal(roleGrants(Role.SUPPORT_ADMIN, 'note:read'), false);
  assert.equal(roleGrants(Role.SUPPORT_ADMIN, 'role:assign'), false);
  assert.equal(roleGrants(Role.SUPPORT_ADMIN, 'user:suspend'), false);
});

test('DOCTOR has clinical access; PATIENT has self-service only', () => {
  assert.equal(roleGrants(Role.DOCTOR, 'note:read'), true);
  assert.equal(roleGrants(Role.DOCTOR, 'document:issue'), true);
  assert.equal(roleGrants(Role.DOCTOR, 'allergy:read'), true);

  assert.equal(roleGrants(Role.PATIENT, 'appointment:book'), true);
  assert.equal(roleGrants(Role.PATIENT, 'allergy:write:own'), true);
  assert.equal(roleGrants(Role.PATIENT, 'note:read'), false);
});

test('only SUPER_ADMIN can verify licenses and publish doctors (§10)', () => {
  assert.equal(roleGrants(Role.SUPER_ADMIN, 'doctor:verify_license'), true);
  assert.equal(roleGrants(Role.SUPER_ADMIN, 'doctor:publish'), true);
  assert.equal(roleGrants(Role.DOCTOR, 'doctor:publish'), false);
  assert.equal(roleGrants(Role.SUPPORT_ADMIN, 'doctor:publish'), false);
});
