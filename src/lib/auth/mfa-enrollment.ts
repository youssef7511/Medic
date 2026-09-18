import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';

export const MFA_ENROLLMENT_TOKEN_TTL_MS = 30 * 60 * 1000;

export function hashMfaEnrollmentToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateMfaEnrollmentToken(): string {
  return randomBytes(32).toString('base64url');
}

export function mfaEnrollmentExpiry(now = new Date()): Date {
  return new Date(now.getTime() + MFA_ENROLLMENT_TOKEN_TTL_MS);
}

/** Read-only check used before showing a QR code. Consumption happens later. */
export async function findValidMfaEnrollmentToken(
  userId: string,
  rawToken: string,
  now = new Date(),
): Promise<{ id: string } | null> {
  if (rawToken.length < 32 || rawToken.length > 128) return null;
  return prisma.mfaEnrollmentToken.findFirst({
    where: {
      userId,
      tokenHash: hashMfaEnrollmentToken(rawToken),
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
}
