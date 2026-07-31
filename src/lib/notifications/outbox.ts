import type { Prisma, PrismaClient } from '@prisma/client';
import type { PlannedMessage } from './schedule';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Writes planned notifications into the outbox. MUST be called with the same
 * transaction client as the state change it accompanies — that atomicity is
 * the entire reason the table exists (see the model docs in schema.prisma).
 */
export async function enqueueMessages(db: Db, messages: PlannedMessage[]): Promise<void> {
  if (messages.length === 0) return;

  await db.outboxMessage.createMany({
    data: messages.map((m) => ({
      topic: m.topic,
      payload: m.payload as unknown as Prisma.InputJsonValue,
      scheduledFor: m.scheduledFor,
    })),
  });
}

/**
 * Cancels not-yet-dispatched messages for an appointment.
 *
 * Without this, cancelling a Thursday appointment still sends the Wednesday
 * "see you tomorrow" reminder. Only PENDING rows are touched — anything
 * already handed to the queue is out of our hands.
 */
export async function cancelPendingFor(db: Db, appointmentId: string): Promise<void> {
  await db.outboxMessage.updateMany({
    where: {
      status: 'PENDING',
      payload: { path: ['appointmentId'], equals: appointmentId },
    },
    data: { status: 'FAILED', lastError: 'superseded: appointment cancelled' },
  });
}
