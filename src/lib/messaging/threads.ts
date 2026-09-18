import { Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { encryptText, decryptText } from '@/lib/crypto/envelope';
import { requireLink, hasPermission as guardHasPermission, ResourceNotFoundError, type Actor } from '@/lib/rbac/guard';

export class MessageValidationError extends Error {
  constructor(public code: string) {
    super(`Invalid message: ${code}`);
    this.name = 'MessageValidationError';
  }
}

export interface ThreadView {
  id: string;
  subject: string | null;
  patientName: string;
  doctorName: string;
  linkId: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageSenderUserId: string | null;
}

export interface MessageView {
  id: string;
  body: string;
  senderUserId: string;
  isOwn: boolean;
  readAt: Date | null;
  createdAt: Date;
}

const MESSAGE_MIN_CHARS = 1;
const MESSAGE_MAX_CHARS = 5000;

function validateMessageBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length < MESSAGE_MIN_CHARS) return 'empty';
  if (trimmed.length > MESSAGE_MAX_CHARS) return 'too_long';
  return null;
}

/**
 * List all threads for a doctor. Each thread is scoped to one PatientDoctorLink.
 * Shows the patient name, last message preview, and unread count.
 */
export async function listDoctorThreads(
  actor: Actor,
  locale = 'fr',
): Promise<ThreadView[]> {
  const doctorProfile = await prisma.doctorProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (!doctorProfile) throw new ResourceNotFoundError();

  const threads = await prisma.messageThread.findMany({
    where: {
      link: { doctorId: doctorProfile.id },
    },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      link: {
        select: {
          id: true,
          patient: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  if (threads.length === 0) return [];

  // Batch-load unread counts and last messages for all threads.
  const threadIds = threads.map((t) => t.id);
  const [unreadCounts, lastMessages] = await Promise.all([
    prisma.message.groupBy({
      by: ['threadId'],
      where: {
        threadId: { in: threadIds },
        senderUserId: { not: actor.userId },
        readAt: null,
      },
      _count: { id: true },
    }),
    prisma.message.findMany({
      where: { threadId: { in: threadIds } },
      orderBy: { createdAt: 'desc' },
      take: threadIds.length, // at most 1 per thread (last message)
      select: { threadId: true, bodyEnc: true, senderUserId: true },
    }),
  ]);

  const unreadMap = new Map(unreadCounts.map((u) => [u.threadId, u._count.id]));
  const lastMsgMap = new Map(lastMessages.map((m) => [m.threadId, m]));

  return Promise.all(threads.map(async (t) => {
    const lastMsg = lastMsgMap.get(t.id);
    return {
      id: t.id,
      subject: t.subject,
      patientName: `${t.link.patient.firstName} ${t.link.patient.lastName}`,
      doctorName: '', // not needed on doctor side
      linkId: t.link.id,
      lastMessageAt: t.lastMessageAt,
      createdAt: t.createdAt,
      unreadCount: unreadMap.get(t.id) ?? 0,
      lastMessagePreview: lastMsg ? (await decryptText(lastMsg.bodyEnc)).slice(0, 100) : '',
      lastMessageSenderUserId: lastMsg?.senderUserId ?? null,
    };
  }));
}

/**
 * List all threads for a patient across all their doctors.
 */
export async function listPatientThreads(
  actor: Actor,
  locale = 'fr',
): Promise<ThreadView[]> {
  const profile = await prisma.patientProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (!profile) throw new ResourceNotFoundError();

  const threads = await prisma.messageThread.findMany({
    where: {
      link: { patientId: profile.id },
    },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      link: {
        select: {
          id: true,
          doctor: { select: { headline: true } },
        },
      },
    },
  });

  if (threads.length === 0) return [];

  const threadIds = threads.map((t) => t.id);
  const [unreadCounts, lastMessages] = await Promise.all([
    prisma.message.groupBy({
      by: ['threadId'],
      where: {
        threadId: { in: threadIds },
        senderUserId: { not: actor.userId },
        readAt: null,
      },
      _count: { id: true },
    }),
    prisma.message.findMany({
      where: { threadId: { in: threadIds } },
      orderBy: { createdAt: 'desc' },
      take: threadIds.length,
      select: { threadId: true, bodyEnc: true, senderUserId: true },
    }),
  ]);

  const unreadMap = new Map(unreadCounts.map((u) => [u.threadId, u._count.id]));
  const lastMsgMap = new Map(lastMessages.map((m) => [m.threadId, m]));

  return Promise.all(threads.map(async (t) => {
    const lastMsg = lastMsgMap.get(t.id);
    const headline = t.link.doctor.headline as Record<string, string> | null;
    return {
      id: t.id,
      subject: t.subject,
      patientName: '', // not needed on patient side
      doctorName: headline?.[locale] ?? headline?.fr ?? '',
      linkId: t.link.id,
      lastMessageAt: t.lastMessageAt,
      createdAt: t.createdAt,
      unreadCount: unreadMap.get(t.id) ?? 0,
      lastMessagePreview: lastMsg ? (await decryptText(lastMsg.bodyEnc)).slice(0, 100) : '',
      lastMessageSenderUserId: lastMsg?.senderUserId ?? null,
    };
  }));
}

/**
 * Load a thread with all messages. Proves the actor is on the thread's link.
 * Marks unread messages from the other party as read.
 */
export async function getThread(
  actor: Actor,
  threadId: string,
): Promise<{ thread: { id: string; subject: string | null; linkId: string }; messages: MessageView[] }> {
  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    select: { id: true, subject: true, linkId: true },
  });
  if (!thread) throw new ResourceNotFoundError();

  // Prove the actor is on this thread's link (§5).
  const permission = guardHasPermission(actor, 'message:read:clinical') ? 'message:read:clinical' : 'message:read:own' as const;
  await requireLink(actor, thread.linkId, permission);

  const messages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
  });

  // Mark messages from the other party as read (§7).
  const unreadIds = messages
    .filter((m) => m.senderUserId !== actor.userId && !m.readAt)
    .map((m) => m.id);

  if (unreadIds.length > 0) {
    await prisma.message.updateMany({
      where: { id: { in: unreadIds } },
      data: { readAt: new Date() },
    });
  }

  return {
    thread: { id: thread.id, subject: thread.subject, linkId: thread.linkId },
    messages: await Promise.all(
      messages.map(async (m) => ({
        id: m.id,
        body: await decryptText(m.bodyEnc),
        senderUserId: m.senderUserId,
        isOwn: m.senderUserId === actor.userId,
        readAt: m.readAt,
        createdAt: m.createdAt,
      })),
    ),
  };
}

/**
 * Send a message in a thread. Creates the thread if it doesn't exist (§7).
 *
 * For the patient side: the thread is resolved from the linkId. If no thread
 * exists, one is created with a default subject.
 *
 * For the doctor side: the threadId is provided directly.
 */
export async function sendMessage(
  actor: Actor,
  args: { threadId?: string; linkId?: string; body: string },
): Promise<MessageView> {
  const invalid = validateMessageBody(args.body);
  if (invalid) throw new MessageValidationError(invalid);

  let threadId = args.threadId;

  if (threadId) {
    // Existing thread — prove the actor is on it.
    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      select: { id: true, linkId: true },
    });
    if (!thread) throw new ResourceNotFoundError();
    const permission = guardHasPermission(actor, 'message:send:clinical') ? 'message:send:clinical' : 'message:send:own' as const;
    await requireLink(actor, thread.linkId, permission);
  } else if (args.linkId) {
    // New thread — create it on the link.
    const permission = guardHasPermission(actor, 'message:send:clinical') ? 'message:send:clinical' : 'message:send:own' as const;
    const link = await requireLink(actor, args.linkId, permission);

    const existing = await prisma.messageThread.findFirst({
      where: { linkId: args.linkId },
      select: { id: true },
    });

    if (existing) {
      threadId = existing.id;
    } else {
      const newThread = await prisma.messageThread.create({
        data: {
          linkId: args.linkId,
          subject: args.body.slice(0, 100),
        },
      });
      threadId = newThread.id;
    }
  } else {
    throw new MessageValidationError('missing_thread_or_link');
  }

  const bodyEnc = await encryptText(args.body.trim());

  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.create({
      data: {
        threadId: threadId!,
        senderUserId: actor.userId,
        bodyEnc,
      },
    });

    // Update thread's lastMessageAt.
    await tx.messageThread.update({
      where: { id: threadId! },
      data: { lastMessageAt: new Date() },
    });

    // Audit the send (§10).
    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: guardHasPermission(actor, 'message:send:clinical') ? Role.DOCTOR : Role.PATIENT,
      action: 'message.send',
      resourceType: 'MessageThread',
      resourceId: threadId!,
    });

    return msg;
  });

  return {
    id: message.id,
    body: args.body.trim(),
    senderUserId: message.senderUserId,
    isOwn: true,
    readAt: null,
    createdAt: message.createdAt,
  };
}
