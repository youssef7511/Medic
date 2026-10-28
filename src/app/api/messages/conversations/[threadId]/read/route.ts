import { z } from 'zod';
import { markMessagesRead } from '@/lib/messaging/e2ee-server';
import { limitedJson, messagingActor, messagingError, privateHeaders } from '@/lib/messaging/e2ee-http';
export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    const actor = await messagingActor(request, true);
    const { threadId } = await context.params;
    const { ids } = z.object({ ids: z.array(z.string().min(1).max(100)).max(100) }).strict().parse(await limitedJson(request, 12000));
    await markMessagesRead(actor, threadId, ids);
    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) { return messagingError(error); }
}
