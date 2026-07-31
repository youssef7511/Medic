import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryObjectStore } from './memory';
import { ObjectNotFoundError, newObjectKey } from './types';

test('put then get round-trips the bytes and content type', async () => {
  const store = new MemoryObjectStore();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await store.put('k', bytes, 'application/pdf');
  const got = await store.get('k');
  assert.deepEqual([...got.body], [1, 2, 3, 4]);
  assert.equal(got.contentType, 'application/pdf');
});

test('get on a missing key throws ObjectNotFoundError', async () => {
  const store = new MemoryObjectStore();
  await assert.rejects(() => store.get('absent'), ObjectNotFoundError);
});

test('delete is idempotent', async () => {
  const store = new MemoryObjectStore();
  await store.put('k', new Uint8Array([9]), 'application/pdf');
  await store.delete('k');
  await store.delete('k'); // second delete must not throw
  assert.equal(store.size(), 0);
});

test('stored bytes are decoupled from the caller buffer', async () => {
  const store = new MemoryObjectStore();
  const bytes = new Uint8Array([1, 2, 3]);
  await store.put('k', bytes, 'application/pdf');
  bytes[0] = 99; // mutate after storing
  const got = await store.get('k');
  assert.equal(got.body[0], 1, 'stored copy must be independent');
});

test('object keys are opaque and unique', () => {
  const a = newObjectKey('documents');
  const b = newObjectKey('documents');
  assert.notEqual(a, b);
  assert.match(a, /^documents\/[0-9a-f-]+\/[0-9a-f]+\.pdf$/);
});
