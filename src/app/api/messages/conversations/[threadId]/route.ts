import { z } from 'zod';
import { getConversation, sendEncryptedMessage } from '@/lib/messaging/e2ee-server';
import { limitedJson, messagingActor, messagingError, privateHeaders } from '@/lib/messaging/e2ee-http';
import { MAX_CIPHERTEXT_BYTES } from '@/lib/messaging/e2ee-types';
export const runtime = 'nodejs';
type Context = { params: Promise<{ threadId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await messagingActor(request);
    const { threadId } = await context.params;
    const locale = new URL(request.url).searchParams.get('locale') === 'ar' ? 'ar' : 'fr';
    const result = await getConversation(actor, threadId, locale, request.headers.get('if-none-match'));
    const headers = { ...privateHeaders, ETag: result.revision };
    return result.data ? Response.json(result.data, { headers }) : new Response(null, { status: 304, headers });
  } catch (error) { return messagingError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await messagingActor(request, true);
    const { threadId } = await context.params;
    const args = z.object({ id: z.string().uuid(), ciphertext: z.string().max(MAX_CIPHERTEXT_BYTES), proof: z.string().max(8000), senderFingerprint: z.string().regex(/^[a-f0-9]{40,64}$/), recipientFingerprint: z.string().regex(/^[a-f0-9]{40,64}$/) }).strict().parse(await limitedJson(request, MAX_CIPHERTEXT_BYTES + 10000));
    const accepted = await sendEncryptedMessage(actor, { threadId, ...args });
    return new Response(null, { status: 201, headers: { ...privateHeaders, 'X-Message-Id': accepted.id } });
  } catch (error) { return messagingError(error); }
}
