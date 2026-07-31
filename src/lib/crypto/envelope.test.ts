import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Set before importing — masterKey() reads the env at call time, but keeping
// this at the top makes the dependency obvious.
process.env.ENCRYPTION_MASTER_KEY = randomBytes(32).toString('base64');

const { encryptText, decryptText, encryptOptional } = await import('./envelope');

test('round-trips text', () => {
  const secret = 'Suspected pneumonia, persistent cough 3 weeks.';
  assert.equal(decryptText(encryptText(secret)), secret);
});

test('round-trips non-Latin text', () => {
  const secret = 'ألم في الصدر منذ أسبوع';
  assert.equal(decryptText(encryptText(secret)), secret);
});

test('same plaintext encrypts to different ciphertexts', () => {
  // Per-record data keys + random IVs: identical input must not be linkable.
  const a = encryptText('headache');
  const b = encryptText('headache');
  assert.notEqual(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'));
});

function flipByte(buf: Uint8Array, index: number): void {
  buf[index] = (buf[index] ?? 0) ^ 0xff;
}

test('tampering with the ciphertext is detected', () => {
  const blob = encryptText('penicillin allergy');
  flipByte(blob, blob.length - 1); // flip bits in the payload
  assert.throws(() => decryptText(blob));
});

test('tampering with the wrapped key is detected', () => {
  const blob = encryptText('penicillin allergy');
  flipByte(blob, 35); // inside the wrapped-key region
  assert.throws(() => decryptText(blob));
});

test('a truncated blob is rejected rather than misparsed', () => {
  assert.throws(() => decryptText(new Uint8Array(20)));
});

test('encryptOptional returns null for empty input', () => {
  assert.equal(encryptOptional(undefined), null);
  assert.equal(encryptOptional(null), null);
  assert.equal(encryptOptional('   '), null);
  assert.notEqual(encryptOptional('real value'), null);
});
