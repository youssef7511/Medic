import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSameOriginRequest } from './request-origin';

test('accepts the public host when the server URL uses a Docker hostname', () => {
  assert.equal(isSameOriginRequest(new Request('http://container-id:3000/api/documents/upload', { headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } })), true);
});
test('accepts the forwarded HTTPS protocol used by a reverse proxy', () => {
  assert.equal(isSameOriginRequest(new Request('http://container:3000/api/documents/upload', { headers: { host: 'medic.example', origin: 'https://medic.example', 'x-forwarded-proto': 'https' } })), true);
});
test('rejects missing origins, other hosts, ports and protocols', () => {
  for (const origin of ['', 'https://evil.example', 'http://localhost:3001', 'https://localhost:3000']) {
    assert.equal(isSameOriginRequest(new Request('http://container:3000/api/documents/upload', { headers: { host: 'localhost:3000', ...(origin ? { origin } : {}) } })), false);
  }
});
