import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { decryptText } from '@/lib/crypto/envelope';
import { requireLinkAny, ResourceNotFoundError, type Actor } from '@/lib/rbac/guard';
import { validateCiphertext, verifyDelivery } from './e2ee-crypto';
import { E2EE_PROTOCOL, type ConversationData, type PublicIdentity, type SecureMessage } from './e2ee-types';

export async function threadParticipants(actor: Actor, threadId: string, locale = 'fr', write = false) {
  const thread = await prisma.messageThread.findUnique({ where: { id: threadId }, include: { link: { include: {
    patient: { select: { userId: true, firstName: true, lastName: true } }, doctor: { select: { userId: true, headline: true } },
  } } } });
  if (!thread || (write && thread.closedAt)) throw new ResourceNotFoundError();
  await requireLinkAny(actor, thread.linkId, write ? ['message:send:clinical', 'message:send:own'] : ['message:read:clinical', 'message:read:own']);
  if (write && thread.link.status !== 'ACTIVE') throw new ResourceNotFoundError();
  const isPatient = actor.userId === thread.link.patient.userId;
  const peerUserId = isPatient ? thread.link.doctor.userId : thread.link.patient.userId;
  const peerName = isPatient ? (thread.link.doctor.headline as Record<string, string>)?.[locale] ?? '' : `${thread.link.patient.firstName} ${thread.link.patient.lastName}`;
  return { threadId: thread.id, closed: Boolean(thread.closedAt), linkId: thread.linkId, patientId: thread.link.patientId, doctorId: thread.link.doctorId, peerUserId, peerName };
}

export async function createConversation(actor: Actor, linkId: string) {
  const link = await requireLinkAny(actor, linkId, ['message:send:clinical', 'message:send:own']);
  if (link.status !== 'ACTIVE') throw new ResourceNotFoundError();
  return prisma.$transaction(async tx => {
    // Serialize creation on the care relationship without deleting or merging historical threads.
    await tx.$queryRaw`SELECT id FROM "PatientDoctorLink" WHERE id = ${linkId} FOR UPDATE`;
    const current = await tx.patientDoctorLink.findUnique({ where: { id: linkId }, select: { status: true } });
    if (current?.status !== 'ACTIVE') throw new ResourceNotFoundError();
    const existing = await tx.messageThread.findFirst({ where: { linkId, closedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    return existing ?? tx.messageThread.create({ data: { linkId }, select: { id: true } });
  });
}

function messageView(row: { id: string; senderUserId: string; encryption: string; bodyEnc: Uint8Array; createdAt: Date; readAt: Date | null }, legacyBody: string | null = null): SecureMessage {
  return { id: row.id, senderUserId: row.senderUserId, encryption: row.encryption,
    ciphertext: row.encryption === E2EE_PROTOCOL ? new TextDecoder().decode(row.bodyEnc) : null,
    legacyBody, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null };
}

export async function getConversation(actor: Actor, threadId: string, locale = 'fr', knownRevision?: string | null): Promise<{ data: ConversationData | null; revision: string }> {
  const context = await threadParticipants(actor, threadId, locale);
  const [identities, rows] = await Promise.all([
    prisma.messagingIdentity.findMany({ where: { userId: { in: [actor.userId, context.peerUserId] } }, select: { userId: true, publicKey: true, fingerprint: true } }),
    prisma.message.findMany({ where: { threadId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  ]);
  const hash = createHash('sha256').update(actor.userId).update(locale).update(context.peerName).update(String(context.closed)).update(JSON.stringify(identities));
  for (const row of rows) hash.update(row.id).update(row.encryption).update(row.bodyEnc).update(row.readAt?.toISOString() ?? '');
  const revision = `"${hash.digest('hex')}"`;
  if (knownRevision === revision) return { data: null, revision };
  // Conditional polls avoid repeatedly decrypting or re-serving historical plaintext.
  await audit(prisma, { actorUserId: actor.userId, actorRole: 'PARTICIPANT', action: 'message.history.read', resourceType: 'MessageThread', resourceId: threadId, patientId: context.patientId, metadata: { count: rows.length } });
  return { revision, data: { threadId, closed: context.closed, selfUserId: actor.userId, peerUserId: context.peerUserId, peerName: context.peerName,
    selfIdentity: identities.find(identity => identity.userId === actor.userId) ?? null,
    peerIdentity: identities.find(identity => identity.userId === context.peerUserId) ?? null,
    messages: await Promise.all(rows.map(async row => messageView(row, row.encryption === 'server-v1' ? await decryptText(row.bodyEnc) : null))),
  } };
}

export async function sendEncryptedMessage(actor: Actor, args: {
  threadId: string; id: string; ciphertext: string; proof: string; senderFingerprint: string; recipientFingerprint: string;
}) {
  const context = await threadParticipants(actor, args.threadId, 'fr', true);
  const identities = await prisma.messagingIdentity.findMany({ where: { userId: { in: [actor.userId, context.peerUserId] } }, select: { userId: true, publicKey: true, fingerprint: true } });
  const self = identities.find(identity => identity.userId === actor.userId);
  const peer = identities.find(identity => identity.userId === context.peerUserId);
  if (!self || !peer || self.fingerprint !== args.senderFingerprint || peer.fingerprint !== args.recipientFingerprint) throw new Error('identity_not_ready');
  await verifyDelivery(args, self, peer);
  await validateCiphertext(args.ciphertext, [self, peer] as PublicIdentity[]);
  const bytes = new TextEncoder().encode(args.ciphertext);
  const replay = async () => {
    const row = await prisma.message.findUnique({ where: { id: args.id } });
    if (!row || row.threadId !== args.threadId || row.senderUserId !== actor.userId || row.encryption !== E2EE_PROTOCOL || !Buffer.from(row.bodyEnc).equals(Buffer.from(bytes))) throw new Error('message_conflict');
    return messageView(row);
  };
  if (await prisma.message.findUnique({ where: { id: args.id }, select: { id: true } })) return replay();
  try {
    return await prisma.$transaction(async tx => {
      const current = await tx.patientDoctorLink.findUnique({ where: { id: context.linkId }, select: { status: true } });
      if (current?.status !== 'ACTIVE') throw new ResourceNotFoundError();
      const row = await tx.message.create({ data: { id: args.id, threadId: args.threadId, senderUserId: actor.userId, bodyEnc: bytes, encryption: E2EE_PROTOCOL } });
      await tx.messageThread.update({ where: { id: args.threadId }, data: { lastMessageAt: row.createdAt } });
      await audit(tx, { actorUserId: actor.userId, actorRole: 'PARTICIPANT', action: 'message.send.e2ee', resourceType: 'Message', resourceId: row.id, patientId: context.patientId });
      return messageView(row);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return replay();
    throw error;
  }
}

export async function markMessagesRead(actor: Actor, threadId: string, ids: string[]) {
  const context = await threadParticipants(actor, threadId);
  const result = await prisma.message.updateMany({ where: { id: { in: ids }, threadId, senderUserId: { not: actor.userId }, readAt: null }, data: { readAt: new Date() } });
  if (result.count) await audit(prisma, { actorUserId: actor.userId, actorRole: 'PARTICIPANT', action: 'message.read', resourceType: 'MessageThread', resourceId: threadId, patientId: context.patientId, metadata: { count: result.count } });
}
