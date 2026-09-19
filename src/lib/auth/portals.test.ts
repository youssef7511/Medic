import test from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { portalLanding, portalOwnsPath, rolesAllowPortal } from './portals';

test('each login portal accepts only its own role family', () => {
  assert.equal(rolesAllowPortal([{ role: Role.PATIENT }], 'patient'), true);
  assert.equal(rolesAllowPortal([{ role: Role.PATIENT }], 'doctor'), false);
  assert.equal(rolesAllowPortal([{ role: Role.DOCTOR }], 'doctor'), true);
  assert.equal(rolesAllowPortal([{ role: Role.DOCTOR_STAFF }], 'doctor'), true);
  assert.equal(rolesAllowPortal([{ role: Role.SUPPORT_ADMIN }], 'admin'), true);
  assert.equal(rolesAllowPortal([{ role: Role.SUPER_ADMIN }], 'admin'), true);
});

test('expired role assignments cannot enter a portal', () => {
  assert.equal(
    rolesAllowPortal(
      [{ role: Role.DOCTOR, expiresAt: new Date('2025-01-01T00:00:00Z') }],
      'doctor',
      new Date('2026-01-01T00:00:00Z'),
    ),
    false,
  );
});

test('portal destinations and next paths stay in the selected space', () => {
  assert.equal(portalLanding('patient', 'fr'), '/fr/p');
  assert.equal(portalOwnsPath('patient', '/fr/p/appointments', 'fr'), true);
  assert.equal(portalOwnsPath('doctor', '/fr/p/appointments', 'fr'), false);
  assert.equal(portalOwnsPath('admin', '/ar/admin/users', 'ar'), true);
});
