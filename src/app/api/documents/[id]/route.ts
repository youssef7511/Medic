import { getCurrentActor } from '@/lib/auth/session';
import { getDocumentForDownload } from '@/lib/documents/prescriptions';
import { ResourceNotFoundError } from '@/lib/rbac/guard';

// Node runtime: decryption, Prisma, and the storage SDK all need it.
export const runtime = 'nodejs';

/**
 * Authorized, audited streaming download (§4b, §10).
 *
 * Deliberately NOT a signed URL: bytes are served through the app after a guard
 * check, so there is no bearer-in-a-URL to leak or replay, and the read is
 * audited at the exact moment the bytes leave. Top-level `/api` (outside
 * `[locale]`) so the next-intl middleware doesn't rewrite it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actor = await getCurrentActor();
  if (!actor) return new Response('Unauthorized', { status: 401 });

  try {
    const { meta, bytes, contentType } = await getDocumentForDownload(actor, id);
    // Copy into a fresh ArrayBuffer so the body is Uint8Array<ArrayBuffer> —
    // the generic Uint8Array<ArrayBufferLike> from storage doesn't satisfy
    // BodyInit (the SharedArrayBuffer variance snag).
    const body = new Uint8Array(new ArrayBuffer(bytes.length));
    body.set(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // `inline` so it opens in the viewer; a revoked/superseded doc is still
        // downloadable (it's part of the record) — status is shown in the UI.
        'Content-Disposition': `inline; filename="ordonnance-v${meta.version}.pdf"`,
        'Content-Length': String(bytes.length),
        // Never let a shared cache hold a patient document.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    // Out-of-scope is indistinguishable from missing (§5).
    if (e instanceof ResourceNotFoundError) return new Response('Not found', { status: 404 });
    throw e;
  }
}
