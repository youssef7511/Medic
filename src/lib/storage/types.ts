import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Object storage behind a narrow interface (§10, §11).
 *
 * Documents (prescription PDFs) live in an S3-compatible bucket in a fixed
 * jurisdiction — never a host-coupled store. The whole surface is these three
 * methods, so swapping the provider (MinIO in dev, any S3 in prod) touches no
 * calling code, and unit tests use an in-memory fake.
 */

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Throws ObjectNotFoundError when the key is absent. */
  get(key: string): Promise<StoredObject>;
  /** Idempotent — deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

/**
 * An opaque, unguessable key. Deliberately NOT derived from patient identity —
 * a key is never an authorization (every read is guarded regardless), and a
 * leaked bucket listing must reveal nothing about who a document belongs to.
 */
export function newObjectKey(prefix: string): string {
  return `${prefix}/${randomUUID()}/${randomBytes(8).toString('hex')}.pdf`;
}
