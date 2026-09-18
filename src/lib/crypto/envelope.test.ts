import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Set before importing — masterKey() reads the env at call time, but keeping
// this at the top makes the dependency obvious.
process.env.ENCRYPTION_MASTER_KEY = randomBytes(32).toString('base64');

const { encryptText, decryptText, encryptOptional } = await import('./envelope');
const { setKeyProviderForTests } = await import('./key-provider');
import type { KeyProvider } from './key-provider';

test('round-trips text', async () => {
  const secret = 'Suspected pneumonia, persistent cough 3 weeks.';
  assert.equal(await decryptText(await encryptText(secret)), secret);
});

test('round-trips non-Latin text', async () => {
  const secret = 'ألم في الصدر منذ أسبوع';
  assert.equal(await decryptText(await encryptText(secret)), secret);
});

test('new writes use the KMS-capable v2 envelope', async () => {
  const blob = await encryptText('headache');
  assert.equal(blob[0], 2);
});

test('same plaintext encrypts to different ciphertexts', async () => {
  // Per-record data keys + random IVs: identical input must not be linkable.
  const a = await encryptText('headache');
  const b = await encryptText('headache');
  assert.notEqual(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'));
});

function flipByte(buf: Uint8Array, index: number): void {
  buf[index] = (buf[index] ?? 0) ^ 0xff;
}

test('tampering with the ciphertext is detected', async () => {
  const blob = await encryptText('penicillin allergy');
  flipByte(blob, blob.length - 1); // flip bits in the payload
  await assert.rejects(() => decryptText(blob));
});

test('tampering with the wrapped key is detected', async () => {
  const blob = await encryptText('penicillin allergy');
  flipByte(blob, 35); // inside the wrapped-key region
  await assert.rejects(() => decryptText(blob));
});

test('a truncated blob is rejected rather than misparsed', async () => {
  await assert.rejects(() => decryptText(new Uint8Array(20)));
});

test('encryptOptional returns null for empty input', async () => {
  assert.equal(await encryptOptional(undefined), null);
  assert.equal(await encryptOptional(null), null);
  assert.equal(await encryptOptional('   '), null);
  assert.notEqual(await encryptOptional('real value'), null);
});

test('v2 delegates data-key wrap and unwrap to the configured KMS boundary', async () => {
  let wraps = 0;
  let unwraps = 0;
  const provider: KeyProvider = {
    name: 'fake-kms',
    async wrapKey(key) {
      wraps += 1;
      return Uint8Array.from([...key].reverse());
    },
    async unwrapKey(key) {
      unwraps += 1;
      return Uint8Array.from([...key].reverse());
    },
  };

  setKeyProviderForTests(provider);
  try {
    const blob = await encryptText('KMS protected');
    assert.equal(await decryptText(blob), 'KMS protected');
    assert.equal(wraps, 1);
    assert.equal(unwraps, 1);
  } finally {
    setKeyProviderForTests(undefined);
  }
});
