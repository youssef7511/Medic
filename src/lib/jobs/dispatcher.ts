import { prisma } from '@/lib/db';
import { getBoss } from './queue';

interface ClaimedRow {
  id: string;
  topic: string;
  payload: unknown;
  scheduledFor: Date;
}

/**
 * Drains the outbox onto pg-boss.
 *
 * Claims rows with `FOR UPDATE SKIP LOCKED` so several workers can run
 * concurrently without handing the same reminder to two of them. Timing is
 * delegated to pg-boss via `startAfter` — the dispatcher forwards everything
 * pending immediately and lets the queue hold it until the moment arrives,
 * so this doesn't need to poll on a tight loop to stay punctual.
 *
 * Failure model: a row is marked DISPATCHED before the enqueue returns, and
 * reset to PENDING if that enqueue throws. A crash in the gap can re-send one
 * message. That's the right trade for notifications — a duplicate reminder is
 * a mild annoyance, a dropped one means a patient misses an appointment.
 */
export async function dispatchOutbox(limit = 100): Promise<number> {
  const claimed = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "OutboxMessage"
    SET status = 'DISPATCHED', "dispatchedAt" = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "OutboxMessage"
      WHERE status = 'PENDING'
      ORDER BY "scheduledFor"
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, topic, payload, "scheduledFor"
  `;

  if (claimed.length === 0) return 0;

  const boss = await getBoss();

  for (const row of claimed) {
    try {
      await boss.send(row.topic, row.payload as object, {
        startAfter: row.scheduledFor,
        singletonKey: row.id, // one queue job per outbox row, even on retry
      });
    } catch (err) {
      await prisma.outboxMessage.update({
        where: { id: row.id },
        data: {
          status: 'PENDING',
          dispatchedAt: null,
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return claimed.length;
}
