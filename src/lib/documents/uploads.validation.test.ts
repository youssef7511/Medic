import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPLOAD_BYTES, validateUpload, UploadValidationError } from './uploads.validation';
const pdf = new TextEncoder().encode('%PDF-1.7\nA medical report\n%%EOF');
const metadata = { title: '  Bilan sanguin  ', category: 'LAB_RESULT', originalName: 'bilan.pdf' };
const error = (code: string) => (failure: unknown) => failure instanceof UploadValidationError && failure.code === code;

test('accepts a PDF with normalized metadata without trusting the filename', () => {
  const result = validateUpload(pdf, 'application/pdf', { ...metadata, originalName: '../private/bilan.pdf' });
  assert.equal(result.contentType, 'application/pdf');
  assert.equal(result.metadata.title, 'Bilan sanguin');
  assert.equal(result.metadata.originalName, 'bilan.pdf');
});
test('rejects a script disguised as a PDF and mismatched MIME types', () => {
  assert.throws(() => validateUpload(new TextEncoder().encode('<script>alert(1)</script>'), 'application/pdf', metadata), error('unsupported_file'));
  assert.throws(() => validateUpload(pdf, 'image/png', metadata), error('unsupported_file'));
});
test('rejects truncated PDFs, empty files and uploads above 10 MiB', () => {
  assert.throws(() => validateUpload(new TextEncoder().encode('%PDF-1.7'), 'application/pdf', metadata), error('unsupported_file'));
  assert.throws(() => validateUpload(new Uint8Array(), '', metadata), error('empty_file'));
  assert.throws(() => validateUpload(new Uint8Array(MAX_UPLOAD_BYTES + 1), '', metadata), error('file_too_large'));
});
test('rejects missing titles, control characters and unsupported categories', () => {
  assert.throws(() => validateUpload(pdf, '', { ...metadata, title: ' ' }), error('invalid_title'));
  assert.throws(() => validateUpload(pdf, '', { ...metadata, title: 'Report\nInjected' }), error('invalid_title'));
  assert.throws(() => validateUpload(pdf, '', { ...metadata, category: 'PRESCRIPTION' }), error('invalid_category'));
});
test('accepts PNG and JPEG signatures and rejects SVG', () => {
  const png = new Uint8Array(33); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(validateUpload(png, 'image/png', metadata).contentType, 'image/png');
  assert.equal(validateUpload(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg', metadata).contentType, 'image/jpeg');
  assert.throws(() => validateUpload(new TextEncoder().encode('<svg/>'), 'image/svg+xml', metadata), error('unsupported_file'));
});
