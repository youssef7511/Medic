import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';

const KEY_LEN = 32;
const LOCAL_IV_LEN = 12;
const LOCAL_TAG_LEN = 16;
const LOCAL_ALGO = 'aes-256-gcm';
const KEY_CONTEXT = Buffer.from('medic:clinical-data-key:v1', 'utf8');

export interface KeyProvider {
  readonly name: string;
  wrapKey(plaintextKey: Uint8Array): Promise<Uint8Array>;
  unwrapKey(wrappedKey: Uint8Array): Promise<Uint8Array>;
}

function localMasterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_MASTER_KEY is required when KMS_PROVIDER=local. Use AWS KMS in production.',
    );
  }

  const key = Buffer.from(raw, raw.length === 64 ? 'hex' : 'base64');
  if (key.length !== KEY_LEN) {
    throw new Error(`ENCRYPTION_MASTER_KEY must decode to ${KEY_LEN} bytes, got ${key.length}.`);
  }
  return key;
}

/** Local-only key wrapper. Production is deliberately refused below. */
export class LocalKeyProvider implements KeyProvider {
  readonly name = 'local';

  async wrapKey(plaintextKey: Uint8Array): Promise<Uint8Array> {
    const iv = randomBytes(LOCAL_IV_LEN);
    const cipher = createCipheriv(LOCAL_ALGO, localMasterKey(), iv);
    cipher.setAAD(KEY_CONTEXT);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintextKey)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  async unwrapKey(wrappedKey: Uint8Array): Promise<Uint8Array> {
    const blob = Buffer.from(wrappedKey);
    const expected = LOCAL_IV_LEN + LOCAL_TAG_LEN + KEY_LEN;
    if (blob.length !== expected) throw new Error('Invalid locally wrapped data key.');

    const decipher = createDecipheriv(
      LOCAL_ALGO,
      localMasterKey(),
      blob.subarray(0, LOCAL_IV_LEN),
    );
    decipher.setAAD(KEY_CONTEXT);
    decipher.setAuthTag(blob.subarray(LOCAL_IV_LEN, LOCAL_IV_LEN + LOCAL_TAG_LEN));
    return Buffer.concat([
      decipher.update(blob.subarray(LOCAL_IV_LEN + LOCAL_TAG_LEN)),
      decipher.final(),
    ]);
  }
}

const AWS_ENCRYPTION_CONTEXT = {
  application: 'medic',
  purpose: 'clinical-envelope-encryption',
};

/** AWS KMS adapter. The ciphertext blob embeds the backing key version. */
export class AwsKmsKeyProvider implements KeyProvider {
  readonly name = 'aws-kms';
  private readonly client: KMSClient;
  private readonly keyId: string;

  constructor(options?: { client?: KMSClient; keyId?: string }) {
    this.keyId = options?.keyId ?? process.env.KMS_KEY_ID ?? '';
    if (!this.keyId) throw new Error('KMS_KEY_ID is required when KMS_PROVIDER=aws.');

    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
    if (!options?.client && !region) {
      throw new Error('AWS_REGION is required when KMS_PROVIDER=aws.');
    }

    this.client =
      options?.client ??
      new KMSClient({
        region,
        ...(process.env.KMS_ENDPOINT ? { endpoint: process.env.KMS_ENDPOINT } : {}),
      });
  }

  async wrapKey(plaintextKey: Uint8Array): Promise<Uint8Array> {
    const result = await this.client.send(
      new EncryptCommand({
        KeyId: this.keyId,
        Plaintext: plaintextKey,
        EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
        EncryptionContext: AWS_ENCRYPTION_CONTEXT,
      }),
    );
    if (!result.CiphertextBlob) throw new Error('AWS KMS returned no ciphertext blob.');
    return result.CiphertextBlob;
  }

  async unwrapKey(wrappedKey: Uint8Array): Promise<Uint8Array> {
    const result = await this.client.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: wrappedKey,
        EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
        EncryptionContext: AWS_ENCRYPTION_CONTEXT,
      }),
    );
    if (!result.Plaintext || result.Plaintext.length !== KEY_LEN) {
      throw new Error('AWS KMS returned an invalid data key.');
    }
    return result.Plaintext;
  }
}

let cachedProvider: KeyProvider | undefined;

export function getKeyProvider(): KeyProvider {
  if (cachedProvider) return cachedProvider;

  const configured = process.env.KMS_PROVIDER?.toLowerCase();
  const provider = configured ?? (process.env.NODE_ENV === 'production' ? 'aws' : 'local');

  if (provider === 'aws' || provider === 'aws-kms') {
    cachedProvider = new AwsKmsKeyProvider();
    return cachedProvider;
  }
  if (provider === 'local') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('KMS_PROVIDER=local is forbidden in production. Configure AWS KMS.');
    }
    cachedProvider = new LocalKeyProvider();
    return cachedProvider;
  }

  throw new Error(`Unsupported KMS_PROVIDER: ${provider}.`);
}

/** Test seam; never used by application code. */
export function setKeyProviderForTests(provider?: KeyProvider): void {
  cachedProvider = provider;
}
