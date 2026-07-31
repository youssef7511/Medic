import { cache } from 'react';
import { UserStatus } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import type { Actor } from '@/lib/rbac/guard';

/**
 * Bridges the auth session → an Actor the guard understands (§5).
 *
 * This is where §10's "revocation is immediate, not eventual" is actually
 * enforced. A signed JWT is NOT sufficient proof of a live session: every
 * request re-checks that
 *   - the Session row still exists and is neither revoked nor expired, and
 *   - the User is still ACTIVE (not suspended or deleted).
 * So suspending an account or killing a session takes effect on the very next
 * request instead of whenever the token happens to expire.
 *
 * `cache()` dedupes this to one DB round-trip per request, even though the
 * layout and several components all ask for the actor.
 */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  const sid = session?.sid;

  if (!userId || !sid) return null;

  const [sessionRow, user] = await Promise.all([
    prisma.session.findUnique({ where: { id: sid } }),
    prisma.user.findUnique({
      where: { id: userId },
      include: { roleAssignments: true },
    }),
  ]);

  // Revoked, expired, or belonging to someone else → not a session.
  if (
    !sessionRow ||
    sessionRow.userId !== userId ||
    sessionRow.revokedAt !== null ||
    sessionRow.expiresAt.getTime() <= Date.now()
  ) {
    return null;
  }

  if (!user || user.status !== UserStatus.ACTIVE) return null;

  return { userId, roles: user.roleAssignments };
});

/** Revokes one session immediately (logout). */
export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every session for a user — used on suspend and password change. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
