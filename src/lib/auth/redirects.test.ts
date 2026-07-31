import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { defaultLandingFor, safeNextPath } from './redirects';

// §4: an unvalidated `next` is an open redirect. These cases are the ones an
// attacker actually tries.

test('rejects absolute URLs to other hosts', () => {
  assert.equal(safeNextPath('https://evil.example/login', 'fr'), '/fr/p');
  assert.equal(safeNextPath('http://evil.example', 'fr'), '/fr/p');
});

test('rejects protocol-relative URLs', () => {
  assert.equal(safeNextPath('//evil.example/login', 'fr'), '/fr/p');
});

test('rejects backslash and scheme smuggling', () => {
  assert.equal(safeNextPath('/\\evil.example', 'fr'), '/fr/p');
  assert.equal(safeNextPath('/redirect?to=javascript://evil', 'fr'), '/fr/p');
});

test('rejects internal paths outside the authenticated spaces', () => {
  assert.equal(safeNextPath('/fr/doctors', 'fr'), '/fr/p');
  assert.equal(safeNextPath('/api/auth/signin', 'fr'), '/fr/p');
});

test('allows the three authenticated spaces and preserves locale', () => {
  assert.equal(safeNextPath('/p/doctors/abc/book', 'fr'), '/fr/p/doctors/abc/book');
  assert.equal(safeNextPath('/fr/p/doctors/abc/book', 'fr'), '/fr/p/doctors/abc/book');
  assert.equal(safeNextPath('/ar/d/calendar', 'ar'), '/ar/d/calendar');
  assert.equal(safeNextPath('/admin/users', 'fr'), '/fr/admin/users');
});

test('falls back to the patient hub when absent or empty', () => {
  assert.equal(safeNextPath(undefined, 'fr'), '/fr/p');
  assert.equal(safeNextPath('', 'ar'), '/ar/p');
});

test('does not treat a lookalike prefix as allowed', () => {
  // "/patients" must not match the "/p" prefix.
  assert.equal(safeNextPath('/patients/secret', 'fr'), '/fr/p');
  assert.equal(safeNextPath('/administrator', 'fr'), '/fr/p');
});

test('an explicit fallback is used when next is absent or rejected', () => {
  assert.equal(safeNextPath(undefined, 'fr', '/fr/d'), '/fr/d');
  assert.equal(safeNextPath('https://evil.example', 'fr', '/fr/d'), '/fr/d');
  // A valid next still wins over the fallback.
  assert.equal(safeNextPath('/p/appointments', 'fr', '/fr/d'), '/fr/p/appointments');
});

// Regression: a doctor used to be dropped into /p, where the role gate bounced
// them straight back out — a successful login that went nowhere.
test('each role lands in the space it can actually enter', () => {
  assert.equal(defaultLandingFor([{ role: Role.DOCTOR }], 'fr'), '/fr/d');
  assert.equal(defaultLandingFor([{ role: Role.DOCTOR_STAFF }], 'fr'), '/fr/d');
  assert.equal(defaultLandingFor([{ role: Role.PATIENT }], 'ar'), '/ar/p');
  assert.equal(defaultLandingFor([{ role: Role.SUPER_ADMIN }], 'fr'), '/fr/admin');
  assert.equal(defaultLandingFor([{ role: Role.SUPPORT_ADMIN }], 'fr'), '/fr/admin');
});

test('a multi-role user lands in the highest-privilege space', () => {
  // A doctor who is also somebody's patient should land in the doctor space.
  assert.equal(defaultLandingFor([{ role: Role.PATIENT }, { role: Role.DOCTOR }], 'fr'), '/fr/d');
  assert.equal(
    defaultLandingFor([{ role: Role.DOCTOR }, { role: Role.SUPER_ADMIN }], 'fr'),
    '/fr/admin',
  );
});

test('a user with no roles falls back to the patient space', () => {
  assert.equal(defaultLandingFor([], 'fr'), '/fr/p');
});
