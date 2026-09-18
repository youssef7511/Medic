import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getKeyProvider } from './key-provider';

/**
 * Versioned envelope encryption for clinical free text (§3.1, §10).
 *
 * v2 layout:
 *   [0]       version
 *   [1..3)    wrapped-key length (uint16 BE)
 *   [3..15)   payload IV (12)
 *   [15..31)  payload tag (16)
 *   [31..N)   KMS/local wrapped data key
 *   [N..]     ciphertext
 *
 * v1 blobs from earlier releases remain readable so KMS rollout does not
 * require rewriting every clinical row in one dangerous migration. New writes
 * always use v2 and a provider selected by KMS_PROVIDER.
 */

const VERSION_V1 = 1;
const VERSION_V2 = 2;
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const V2_HEADER_LEN = 3;
const V2_FIXED_LEN = V2_HEADER_LEN + IV_LEN + TAG_LEN;

function toPrismaBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(value.length));
  out.set(value);
  return out;
}

export async function encryptText(plaintext: string): Promise<Uint8Array<ArrayBuffer>> {
  const dataKey = randomBytes(KEY_LEN);
  try {
    const wrappedKey = Buffer.from(await getKeyProvider().wrapKey(dataKey));
    if (wrappedKey.length > 0xffff) throw new Error('Wrapped data key is too large.');

    const header = Buffer.alloc(V2_HEADER_LEN);
    header[0] = VERSION_V2;
    header.writeUInt16BE(wrappedKey.length, 1);

    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, dataKey, iv);
    cipher.setAAD(Buffer.concat([header, wrappedKey]));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return toPrismaBytes(
      Buffer.concat([header, iv, cipher.getAuthTag(), wrappedKey, ciphertext]),
    );
  } finally {
    dataKey.fill(0);
  }
}

export async function decryptText(blob: Buffer | Uint8Array): Promise<string> {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length < 1) throw new Error('Ciphertext too short / corrupt.');
  if (buf[0] === VERSION_V1) return decryptLegacyV1(buf);
  if (buf[0] !== VERSION_V2) throw new Error(`Unsupported ciphertext version: ${buf[0]}`);
  if (buf.length < V2_FIXED_LEN) throw new Error('Ciphertext too short / corrupt.');

  const wrappedLength = buf.readUInt16BE(1);
  const wrappedStart = V2_FIXED_LEN;
  const ciphertextStart = wrappedStart + wrappedLength;
  if (wrappedLength === 0 || buf.length < ciphertextStart) {
    throw new Error('Ciphertext contains an invalid wrapped-key length.');
  }

  const header = buf.subarray(0, V2_HEADER_LEN);
  const iv = buf.subarray(V2_HEADER_LEN, V2_HEADER_LEN + IV_LEN);
  const tag = buf.subarray(V2_HEADER_LEN + IV_LEN, V2_FIXED_LEN);
  const wrappedKey = buf.subarray(wrappedStart, ciphertextStart);
  const ciphertext = buf.subarray(ciphertextStart);
  const dataKey = Buffer.from(await getKeyProvider().unwrapKey(wrappedKey));

  if (dataKey.length !== KEY_LEN) {
    dataKey.fill(0);
    throw new Error('Unwrapped data key has an invalid length.');
  }

  try {
    const decipher = createDecipheriv(ALGO, dataKey, iv);
    decipher.setAAD(Buffer.concat([header, wrappedKey]));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } finally {
    dataKey.fill(0);
  }
}

export async function encryptOptional(
  value: string | null | undefined,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const trimmed = value?.trim();
  return trimmed ? encryptText(trimmed) : null;
}

// Legacy v1 support. This path is intentionally local-key-only and disappears
// after a controlled rewrap job has migrated all v1 rows.
function legacyMasterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_MASTER_KEY is required to read legacy v1 ciphertext.');
  }
  const key = Buffer.from(raw, raw.length === 64 ? 'hex' : 'base64');
  if (key.length !== KEY_LEN) throw new Error('Invalid legacy ENCRYPTION_MASTER_KEY.');
  return key;
}

function decryptLegacyV1(buf: Buffer): string {
  const offWrapIv = 1;
  const offWrapTag = offWrapIv + IV_LEN;
  const offWrappedKey = offWrapTag + TAG_LEN;
  const offIv = offWrappedKey + KEY_LEN;
  const offTag = offIv + IV_LEN;
  const offCiphertext = offTag + TAG_LEN;
  if (buf.length < offCiphertext) throw new Error('Ciphertext too short / corrupt.');

  const unwrap = createDecipheriv(ALGO, legacyMasterKey(), buf.subarray(offWrapIv, offWrapTag));
  unwrap.setAuthTag(buf.subarray(offWrapTag, offWrappedKey));
  const dataKey = Buffer.concat([
    unwrap.update(buf.subarray(offWrappedKey, offIv)),
    unwrap.final(),
  ]);

  try {
    const decipher = createDecipheriv(ALGO, dataKey, buf.subarray(offIv, offTag));
    decipher.setAuthTag(buf.subarray(offTag, offCiphertext));
    return Buffer.concat([
      decipher.update(buf.subarray(offCiphertext)),
      decipher.final(),
    ]).toString('utf8');
  } finally {
    dataKey.fill(0);
  }
}
