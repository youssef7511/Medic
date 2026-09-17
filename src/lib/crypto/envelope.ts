import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * App-layer envelope encryption for clinical free text (§3.1, §10):
 * consultation notes, messages, reason-for-visit, allergies.
 *
 * Envelope, not plain symmetric: every record gets its own random data key,
 * and only that data key is wrapped by the master key. So rotating the master
 * key rewraps keys instead of rewriting every ciphertext, and one leaked data
 * key exposes one record rather than the archive.
 *
 * Layout (all lengths fixed, so parsing needs no framing):
 *   [0]      version
 *   [1..13)  wrap IV      (12)
 *   [13..29) wrap tag     (16)
 *   [29..61) wrapped key  (32)
 *   [61..73) payload IV   (12)
 *   [73..89) payload tag  (16)
 *   [89..]   ciphertext
 *
 * TODO(kms): `masterKey()` reads an env var — fine for local dev, NOT for
 * production. In production the master key belongs in a KMS and the wrap/unwrap
 * steps become KMS calls. Only these two functions change (§10).
 */

const VERSION = 1;
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

// Offsets derived from the lengths above rather than hardcoded, so the layout
// comment and the parser can't drift apart.
const OFF_WRAP_IV = 1;
const OFF_WRAP_TAG = OFF_WRAP_IV + IV_LEN;
const OFF_WRAPPED_KEY = OFF_WRAP_TAG + TAG_LEN;
const OFF_IV = OFF_WRAPPED_KEY + KEY_LEN;
const OFF_TAG = OFF_IV + IV_LEN;
const OFF_CIPHERTEXT = OFF_TAG + TAG_LEN;

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_MASTER_KEY is not set — refusing to handle clinical data unencrypted.',
    );
  }
  // Accept base64 or hex; require a full 256-bit key either way.
  const key = Buffer.from(raw, raw.length === 64 ? 'hex' : 'base64');
  if (key.length !== KEY_LEN) {
    throw new Error(`ENCRYPTION_MASTER_KEY must decode to ${KEY_LEN} bytes, got ${key.length}.`);
  }
  return key;
}

// Returns Uint8Array rather than Buffer: Prisma's `Bytes` maps to
// Uint8Array<ArrayBuffer>, and Node's Buffer<ArrayBufferLike> isn't assignable
// to it. Copying into a fresh Uint8Array satisfies the type and detaches the
// ciphertext from Node's shared internal pool.
export function encryptText(plaintext: string): Uint8Array<ArrayBuffer> {
  const master = masterKey();
  const dataKey = randomBytes(KEY_LEN);

  const wrapIv = randomBytes(IV_LEN);
  const wrapCipher = createCipheriv(ALGO, master, wrapIv);
  const wrappedKey = Buffer.concat([wrapCipher.update(dataKey), wrapCipher.final()]);
  const wrapTag = wrapCipher.getAuthTag();

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  dataKey.fill(0); // don't leave the plaintext key sitting in the heap

  const combined = Buffer.concat([
    Buffer.from([VERSION]),
    wrapIv,
    wrapTag,
    wrappedKey,
    iv,
    tag,
    ciphertext,
  ]);

  // Allocate a dedicated ArrayBuffer so the result is Uint8Array<ArrayBuffer>,
  // which is what Prisma's `Bytes` expects. A Buffer's backing store is typed
  // ArrayBufferLike (it may be SharedArrayBuffer) and won't assign.
  const out = new Uint8Array(new ArrayBuffer(combined.length));
  out.set(combined);
  return out;
}

export function decryptText(blob: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length < OFF_CIPHERTEXT) throw new Error('Ciphertext too short / corrupt.');
  if (buf[0] !== VERSION) throw new Error(`Unsupported ciphertext version: ${buf[0]}`);

  const master = masterKey();

  const wrapIv = buf.subarray(OFF_WRAP_IV, OFF_WRAP_TAG);
  const wrapTag = buf.subarray(OFF_WRAP_TAG, OFF_WRAPPED_KEY);
  const wrappedKey = buf.subarray(OFF_WRAPPED_KEY, OFF_IV);
  const iv = buf.subarray(OFF_IV, OFF_TAG);
  const tag = buf.subarray(OFF_TAG, OFF_CIPHERTEXT);
  const ciphertext = buf.subarray(OFF_CIPHERTEXT);

  const unwrap = createDecipheriv(ALGO, master, wrapIv);
  unwrap.setAuthTag(wrapTag);
  const dataKey = Buffer.concat([unwrap.update(wrappedKey), unwrap.final()]);

  const decipher = createDecipheriv(ALGO, dataKey, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

  dataKey.fill(0);
  return plaintext;
}

/** Convenience for optional fields. */
export function encryptOptional(value: string | null | undefined): Uint8Array<ArrayBuffer> | null {
  const trimmed = value?.trim();
  return trimmed ? encryptText(trimmed) : null;
}
