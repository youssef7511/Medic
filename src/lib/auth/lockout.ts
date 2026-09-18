import { prisma } from '@/lib/db';

export const LOCKOUT_THRESHOLD = 5;
export const MAX_LOCKOUT_MS = 30 * 60 * 1000;

/** Exponential backoff: 30s, 60s, 2m… capped at 30 minutes. */
export function lockoutDurationMs(failedAttempts: number): number {
  if (failedAttempts < LOCKOUT_THRESHOLD) return 0;
  const exponent = failedAttempts - LOCKOUT_THRESHOLD;
  return Math.min(30_000 * 2 ** exponent, MAX_LOCKOUT_MS);
}

export function isLoginLocked(lockedUntil: Date | null, now = new Date()): boolean {
  return Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());
}

export async function recordLoginFailure(userId: string): Promise<void> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });
  const duration = lockoutDurationMs(user.failedLoginAttempts);
  if (duration > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + duration) },
    });
  }
}

export async function clearLoginFailures(userId: string): Promise<void> {
  await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ failedLoginAttempts: { gt: 0 } }, { lockedUntil: { not: null } }],
    },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
