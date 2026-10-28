import { prisma } from '@/lib/db';
import { decryptText } from '@/lib/crypto/envelope';
import { requireLinkAny, hasPermission, ResourceNotFoundError, type Actor } from '@/lib/rbac/guard';
import { E2EE_PROTOCOL } from './e2ee-types';

export class MessageValidationError extends Error {
  constructor(public code: string) { super(`Invalid message: ${code}`); this.name = 'MessageValidationError'; }
}
export interface ThreadView {
  id: string; subject: string | null; patientName: string; doctorName: string; linkId: string;
  lastMessageAt: Date | null; createdAt: Date; unreadCount: number; lastMessagePreview: string; lastMessageSenderUserId: string | null;
}
export interface MessageView { id: string; body: string; senderUserId: string; isOwn: boolean; readAt: Date | null; createdAt: Date }

async function listThreads(actor: Actor, side: 'doctor' | 'patient', locale: string): Promise<ThreadView[]> {
  const permission = side === 'doctor' ? 'message:read:clinical' : 'message:read:own';
  if (!hasPermission(actor, permission)) throw new ResourceNotFoundError();
  const rows = await prisma.messageThread.findMany({
    where: { link: { status: 'ACTIVE', ...(side === 'doctor' ? { doctor: { userId: actor.userId } } : { patient: { userId: actor.userId } }) } },
    include: { link: { select: { patient: { select: { firstName: true, lastName: true } }, doctor: { select: { headline: true } } } }, messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { senderUserId: true, encryption: true } } },
    orderBy: { lastMessageAt: 'desc' },
  });
  const unread = rows.length ? await prisma.message.groupBy({ by: ['threadId'], where: { threadId: { in: rows.map(row => row.id) }, senderUserId: { not: actor.userId }, readAt: null }, _count: { id: true } }) : [];
  const counts = new Map(unread.map(row => [row.threadId, row._count.id]));
  return rows.map(row => ({
    id: row.id, subject: null, linkId: row.linkId, patientName: `${row.link.patient.firstName} ${row.link.patient.lastName}`,
    doctorName: (row.link.doctor.headline as Record<string, string>)?.[locale] ?? '',
    lastMessageAt: row.lastMessageAt, createdAt: row.createdAt, unreadCount: counts.get(row.id) ?? 0,
    lastMessageSenderUserId: row.messages[0]?.senderUserId ?? null,
    lastMessagePreview: !row.messages.length ? '' : row.messages[0]!.encryption === E2EE_PROTOCOL ? (locale === 'ar' ? 'رسالة مشفرة من طرف إلى طرف' : 'Message chiffré de bout en bout') : (locale === 'ar' ? 'رسالة قديمة — تشفير الخادم' : 'Ancien message — chiffrement serveur'),
  }));
}
export const listDoctorThreads = (actor: Actor, locale = 'fr') => listThreads(actor, 'doctor', locale);
export const listPatientThreads = (actor: Actor, locale = 'fr') => listThreads(actor, 'patient', locale);

/** Legacy callers get no encrypted-message plaintext. New UI decrypts only in the browser. */
export async function getThread(actor: Actor, threadId: string) {
  const thread = await prisma.messageThread.findUnique({ where: { id: threadId }, select: { id: true, linkId: true } });
  if (!thread) throw new ResourceNotFoundError();
  await requireLinkAny(actor, thread.linkId, ['message:read:clinical', 'message:read:own']);
  const rows = await prisma.message.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } });
  return { thread: { ...thread, subject: null }, messages: await Promise.all(rows.map(async row => ({
    id: row.id, body: row.encryption === 'server-v1' ? await decryptText(row.bodyEnc) : '[E2EE]',
    senderUserId: row.senderUserId, isOwn: row.senderUserId === actor.userId, readAt: row.readAt, createdAt: row.createdAt,
  }))) };
}

/** Plaintext sends are deliberately refused, including requests from outdated clients. */
export async function sendMessage(_actor: Actor, _args: { threadId?: string; linkId?: string; body: string }): Promise<MessageView> {
  throw new MessageValidationError('e2ee_required');
}
