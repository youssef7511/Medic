import { z } from 'zod';
import { createConversation } from '@/lib/messaging/e2ee-server';
import { limitedJson, messagingActor, messagingError, privateHeaders } from '@/lib/messaging/e2ee-http';
export async function POST(request: Request) {
  try {
    const actor = await messagingActor(request, true);
    const { linkId } = z.object({ linkId: z.string().min(1).max(100) }).strict().parse(await limitedJson(request, 1000));
    return Response.json(await createConversation(actor, linkId), { status: 201, headers: privateHeaders });
  } catch (error) { return messagingError(error); }
}
