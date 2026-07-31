import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_MAX_CHARS,
  RETRACTION_REASON_MIN_CHARS,
  REVISION_COALESCE_MINUTES,
  validateNoteContent,
  validateRetractionReason,
  shouldWriteRevision,
} from './notes.validation';

test('accepts ordinary note content', () => {
  assert.equal(validateNoteContent('Patient reports chest pain since Tuesday.'), null);
});

test('rejects empty or whitespace-only content', () => {
  // A blank note would clutter the journal with an unusable record.
  assert.equal(validateNoteContent(''), 'empty');
  assert.equal(validateNoteContent('   \n\t '), 'empty');
});

test('rejects content over the limit', () => {
  assert.equal(validateNoteContent('x'.repeat(NOTE_MAX_CHARS)), null);
  assert.equal(validateNoteContent('x'.repeat(NOTE_MAX_CHARS + 1)), 'too_long');
});

test('retraction reason must be substantive', () => {
  // "oops" is not a record of why a clinical entry was withdrawn.
  assert.equal(validateRetractionReason('oops'), 'reason_too_short');
  assert.equal(validateRetractionReason('x'.repeat(RETRACTION_REASON_MIN_CHARS)), null);
});

test('whitespace does not count toward the retraction minimum', () => {
  assert.equal(validateRetractionReason('  a  '), 'reason_too_short');
});

test('retraction reason has an upper bound', () => {
  assert.equal(validateRetractionReason('x'.repeat(501)), 'reason_too_long');
});

test('an explicit save always writes a revision', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  assert.equal(
    shouldWriteRevision({ explicit: true, lastRevisionAt: now, now }),
    true,
    'a deliberate save is a checkpoint regardless of timing',
  );
});

test('autosave inside the coalescing window does not write a revision', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  const lastRevisionAt = new Date(now.getTime() - 60_000); // 1 minute ago
  assert.equal(shouldWriteRevision({ explicit: false, lastRevisionAt, now }), false);
});

test('autosave past the coalescing window writes a revision', () => {
  // Bounds how far the immutable trail can lag behind current text.
  const now = new Date('2026-07-19T12:00:00Z');
  const lastRevisionAt = new Date(now.getTime() - (REVISION_COALESCE_MINUTES * 60_000 + 1000));
  assert.equal(shouldWriteRevision({ explicit: false, lastRevisionAt, now }), true);
});

test('autosave exactly at the window boundary writes a revision', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  const lastRevisionAt = new Date(now.getTime() - REVISION_COALESCE_MINUTES * 60_000);
  assert.equal(shouldWriteRevision({ explicit: false, lastRevisionAt, now }), true);
});
