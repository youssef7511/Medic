import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyIdentityProof } from '@/lib/messaging/e2ee-crypto';
import { limitedJson, messagingActor, messagingError, privateHeaders } from '@/lib/messaging/e2ee-http';
import { audit } from '@/lib/audit';

export const runtime = 'nodejs';
const schema = z.object({ publicKey: z.string().max(16000), proof: z.string().max(8000) }).strict();
export async function GET(request: Request) {
  try {
    const actor = await messagingActor(request);
    return Response.json(await prisma.messagingIdentity.findUnique({ where: { userId: actor.userId }, select: { userId: true, publicKey: true, fingerprint: true } }), { headers: privateHeaders });
  } catch (error) { return messagingError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await messagingActor(request, true);
    const { publicKey, proof } = schema.parse(await limitedJson(request, 26000));
    const fingerprint = await verifyIdentityProof(actor.userId, publicKey, proof);
    const current = await prisma.messagingIdentity.findUnique({ where: { userId: actor.userId } });
    if (current) return current.fingerprint === fingerprint ? Response.json(current, { headers: privateHeaders }) : Response.json({ error: 'identity_exists' }, { status: 409, headers: privateHeaders });
    try {
      const result = await prisma.$transaction(async tx => {
        const identity = await tx.messagingIdentity.create({ data: { userId: actor.userId, publicKey, fingerprint } });
        await audit(tx, { actorUserId: actor.userId, actorRole: 'PARTICIPANT', action: 'messaging.identity.create', resourceType: 'User', resourceId: actor.userId });
        return identity;
      });
      return Response.json(result, { status: 201, headers: privateHeaders });
    } catch {
      const winner = await prisma.messagingIdentity.findUnique({ where: { userId: actor.userId } });
      if (winner?.fingerprint === fingerprint) return Response.json(winner, { headers: privateHeaders });
      return Response.json({ error: 'identity_exists' }, { status: 409, headers: privateHeaders });
    }
  } catch (error) { return messagingError(error); }
}
