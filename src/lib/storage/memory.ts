import { ObjectNotFoundError, type ObjectStore, type StoredObject } from './types';

/**
 * In-memory object store for unit tests. Never used in a running app — the
 * selector in index.ts picks this only when no storage endpoint is configured,
 * which in practice means the test process.
 */
export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, StoredObject>();

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    // Copy so a later mutation of the caller's buffer can't change stored bytes.
    this.objects.set(key, { body: Uint8Array.from(body), contentType });
  }

  async get(key: string): Promise<StoredObject> {
    const found = this.objects.get(key);
    if (!found) throw new ObjectNotFoundError(key);
    return { body: Uint8Array.from(found.body), contentType: found.contentType };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /** Test helper. */
  size(): number {
    return this.objects.size;
  }
}
