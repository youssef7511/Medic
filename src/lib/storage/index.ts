import type { ObjectStore } from './types';
import { MemoryObjectStore } from './memory';
import { S3ObjectStore } from './s3';

export * from './types';

let cached: ObjectStore | null = null;

/**
 * Returns the configured object store.
 *
 * No `STORAGE_ENDPOINT` → the in-memory fake (unit tests). Configured → S3.
 * A production deployment MUST set the storage env; running the real app
 * against the memory store would silently lose every document on restart, so
 * we fail loudly if the endpoint is set but credentials are missing.
 */
export function getObjectStore(): ObjectStore {
  if (cached) return cached;

  const endpoint = process.env.STORAGE_ENDPOINT;
  if (!endpoint) {
    cached = new MemoryObjectStore();
    return cached;
  }

  const bucket = process.env.STORAGE_BUCKET;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'STORAGE_ENDPOINT is set but STORAGE_BUCKET / STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY are missing.',
    );
  }

  cached = new S3ObjectStore({
    endpoint,
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    bucket,
    accessKeyId,
    secretAccessKey,
  });
  return cached;
}

/** Test seam: drop the cached instance. */
export function resetObjectStore(): void {
  cached = null;
}
