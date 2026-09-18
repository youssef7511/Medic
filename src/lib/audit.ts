import { headers } from 'next/headers';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '@/lib/db';

// Accepts either the client or a transaction client, so an audit row can be
// written inside the same transaction as the thing it records — if the action
// rolls back, so does its audit entry.
type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  /** Denormalized so "who touched this patient's data?" is one indexed query (§10). */
  patientId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

async function requestContext(): Promise<{ ip?: string; userAgent?: string }> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    return {
      ip: forwarded?.split(',')[0]?.trim() ?? undefined,
      userAgent: h.get('user-agent') ?? undefined,
    };
  } catch {
    // Called outside a request scope (job, script) — no context to attach.
    return {};
  }
}

/**
 * Writes an append-only audit row (§10).
 *
 * Deliberately never throws: a failure to log must not take down the action
 * being logged. It reports loudly instead — a silently missing audit trail is
 * the worst of both worlds, so this is the one place a console error is right.
 */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  try {
    await writeAudit(db, entry);
  } catch (err) {
    console.error('[audit] FAILED to write audit entry', entry.action, err);
  }
}

async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  const ctx = await requestContext();
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      actorRole: entry.actorRole,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      patientId: entry.patientId ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
    },
  });
}

/**
 * Security-critical audit. Unlike the best-effort general audit helper, this
 * throws so the enclosing transaction/read fails closed if the event cannot be
 * recorded. Break-glass must never become "access now, maybe audit later".
 */
export function auditCritical(db: Db, entry: AuditEntry): Promise<void> {
  return writeAudit(db, entry);
}

/** Convenience wrapper for the non-transactional case. */
export function auditNow(entry: AuditEntry): Promise<void> {
  return audit(defaultClient, entry);
}
