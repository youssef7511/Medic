import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPublishDoctor, doctorOnboardingState } from './doctor-onboarding';

test('unverified doctors cannot be published', () => {
  const doctor = { isPublished: false, licenseVerifiedAt: null };
  assert.equal(doctorOnboardingState(doctor), 'UNVERIFIED');
  assert.equal(canPublishDoctor(doctor), false);
});

test('verification opens the publish gate exactly once', () => {
  const verified = { isPublished: false, licenseVerifiedAt: new Date() };
  assert.equal(doctorOnboardingState(verified), 'VERIFIED');
  assert.equal(canPublishDoctor(verified), true);

  const published = { ...verified, isPublished: true };
  assert.equal(doctorOnboardingState(published), 'PUBLISHED');
  assert.equal(canPublishDoctor(published), false);
});
