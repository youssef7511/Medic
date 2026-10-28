import { isSameOriginRequest } from '@/lib/auth/request-origin';
import { getCurrentActor } from '@/lib/auth/session';
import { uploadPatientDocument } from '@/lib/documents/uploads';
import { MAX_UPLOAD_BYTES, UploadValidationError } from '@/lib/documents/uploads.validation';
import { ResourceNotFoundError, hasPermission } from '@/lib/rbac/guard';
import { revalidatePath } from 'next/cache';

export const runtime = 'nodejs';
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 128 * 1024;

export async function POST(request: Request) {
  const actor = await getCurrentActor();
  if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!hasPermission(actor, 'document:upload:own')) return Response.json({ error: 'not_found' }, { status: 404 });
  // API mutations use an explicit same-origin check (server actions do this automatically).
  if (!isSameOriginRequest(request)) return Response.json({ error: 'invalid_origin' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) return Response.json({ error: 'invalid_request' }, { status: 400 });
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) return Response.json({ error: 'file_too_large' }, { status: 413 });
  if (!process.env.STORAGE_ENDPOINT) return Response.json({ error: 'storage_unavailable' }, { status: 503 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: 'empty_file' }, { status: 400 });
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return Response.json({ error: 'file_too_large' }, { status: 413 });
      }
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    let form: FormData;
    try { form = await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData(); }
    catch { return Response.json({ error: 'invalid_request' }, { status: 400 }); }
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'empty_file' }, { status: 400 });
    const result = await uploadPatientDocument(actor, {
      linkId: String(form.get('linkId') ?? ''), bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type, originalName: file.name,
      title: String(form.get('title') ?? ''), category: String(form.get('category') ?? ''),
    });
    revalidatePath('/[locale]/p', 'page');
    revalidatePath('/[locale]/p/documents', 'page');
    revalidatePath('/[locale]/p/doctors/[doctorId]/documents', 'page');
    revalidatePath('/[locale]/d/patients/[linkId]/documents', 'page');
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof UploadValidationError) return Response.json({ error: error.code }, { status: error.code === 'file_too_large' ? 413 : 400 });
    if (error instanceof ResourceNotFoundError) return Response.json({ error: 'not_found' }, { status: 404 });
    console.error('[document.upload] Failed', error);
    return Response.json({ error: 'upload_failed' }, { status: 500 });
  } finally { reader.releaseLock(); }
}
