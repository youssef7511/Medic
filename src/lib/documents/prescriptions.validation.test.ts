import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DURATION_MAX_DAYS,
  MAX_MEDICATION_LINES,
  validateMedications,
  validateRevokeReason,
  type MedicationLine,
} from './prescriptions.validation';
import { classifyAllergy } from '@/lib/clinical/allergies';

const line = (over: Partial<MedicationLine> = {}): MedicationLine => ({
  drug: 'Amoxicilline',
  dose: '500 mg',
  ...over,
});

test('a well-formed prescription passes', () => {
  assert.equal(validateMedications([line()]), null);
});

test('an empty medication list is rejected', () => {
  assert.equal(validateMedications([]), 'empty');
});

test('too many lines is rejected', () => {
  const many = Array.from({ length: MAX_MEDICATION_LINES + 1 }, () => line());
  assert.equal(validateMedications(many), 'too_many');
});

test('a line without a drug or dose is rejected', () => {
  assert.equal(validateMedications([line({ drug: '   ' })]), 'line_missing_drug');
  assert.equal(validateMedications([line({ dose: '' })]), 'line_missing_dose');
});

test('an over-length field is rejected', () => {
  assert.equal(validateMedications([line({ drug: 'x'.repeat(201) })]), 'line_too_long');
});

test('an out-of-range duration is rejected', () => {
  assert.equal(validateMedications([line({ durationDays: 0 })]), 'duration_out_of_range');
  assert.equal(
    validateMedications([line({ durationDays: DURATION_MAX_DAYS + 1 })]),
    'duration_out_of_range',
  );
  assert.equal(validateMedications([line({ durationDays: 2.5 })]), 'duration_out_of_range');
  assert.equal(validateMedications([line({ durationDays: 7 })]), null);
});

test('revoke reason must be substantive', () => {
  assert.equal(validateRevokeReason('oops'), 'reason_too_short');
  assert.equal(validateRevokeReason('  a  '), 'reason_too_short');
  assert.equal(validateRevokeReason('x'.repeat(501)), 'reason_too_long');
  assert.equal(validateRevokeReason('Erreur de dossier patient.'), null);
});

// Allergy classification — the three clinically-distinct states (§3.1).

test('a listed allergy classifies as listed', () => {
  assert.deepEqual(classifyAllergy({ text: 'Pénicilline', affirmedNone: false }), {
    kind: 'listed',
    text: 'Pénicilline',
  });
});

test('an affirmed absence classifies as none', () => {
  assert.deepEqual(classifyAllergy({ text: null, affirmedNone: true }), { kind: 'none' });
  // Empty text + affirmed is still "none", not "listed".
  assert.deepEqual(classifyAllergy({ text: '   ', affirmedNone: true }), { kind: 'none' });
});

test('neither text nor affirmation is not_recorded, NOT none', () => {
  // The safety-critical distinction: absence of data is not a clean bill.
  assert.deepEqual(classifyAllergy({ text: null, affirmedNone: false }), { kind: 'not_recorded' });
  assert.deepEqual(classifyAllergy({ text: '', affirmedNone: false }), { kind: 'not_recorded' });
});

test('listed wins even if affirmedNone is somehow also set', () => {
  assert.deepEqual(classifyAllergy({ text: 'Aspirine', affirmedNone: true }), {
    kind: 'listed',
    text: 'Aspirine',
  });
});
