import { isSameOriginRequest } from '@/lib/auth/request-origin';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, ResourceNotFoundError } from '@/lib/rbac/guard';

export const privateHeaders = { 'Cache-Control': 'private, no-store' };
export async function messagingActor(request: Request, mutate = false) {
  const actor = await getCurrentActor();
  if (!actor) throw new Response('Unauthorized', { status: 401, headers: privateHeaders });
  if (!hasPermission(actor, 'message:read:clinical') && !hasPermission(actor, 'message:read:own')) throw new ResourceNotFoundError();
  if (mutate && !isSameOriginRequest(request)) throw new Response('Invalid origin', { status: 403, headers: privateHeaders });
  return actor;
}
export async function limitedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Response('Invalid request', { status: 400 });
  const reader = request.body?.getReader();
  if (!reader) throw new Response('Missing body', { status: 400 });
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Response('Too large', { status: 413 }); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Response('Invalid JSON', { status: 400 }); }
}
export function messagingError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof ResourceNotFoundError) return new Response('Not found', { status: 404, headers: privateHeaders });
  // Do not log ciphertext, message contents, keys or user-supplied cryptographic errors.
  return Response.json({ error: 'invalid_secure_request' }, { status: 400, headers: privateHeaders });
}
