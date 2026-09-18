'use server';

import { z } from 'zod';
import QRCode from 'qrcode';
import { UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { verifyPassword, fakeVerify } from '@/lib/auth/password';
import { buildMfaUri, generateMfaSecret, rolesRequireMfa, verifyMfaToken } from '@/lib/auth/totp';
import { audit } from '@/lib/audit';
import { findValidMfaEnrollmentToken } from '@/lib/auth/mfa-enrollment';
import { isLoginLocked, recordLoginFailure } from '@/lib/auth/lockout';

/**
 * First-login 2FA enrollment for privileged accounts (§10).
 *
 * Without this a doctor account is unusable: login refuses an un-enrolled
 * privileged user, and there was previously no way to enroll.
 *
 * Password possession is not enough: an admin-issued, short-lived, single-use
 * token must also be presented. This closes the pre-enrollment password-leak
 * window where an attacker could otherwise bind their own authenticator.
 */

export type EnrollState = {
  step: 'credentials' | 'verify' | 'done';
  error?: string;
  qrDataUrl?: string;
  manualKey?: string;
  email?: string;
};

const beginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  enrollmentToken: z.string().min(32).max(128),
});

/** Generic failure — never distinguishes "no such user" from "wrong password". */
const GENERIC = 'Invalid credentials, or this account does not require enrollment.';

async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { roleAssignments: true },
  });

  if (!user?.passwordHash) {
    await fakeVerify();
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    if (!isLoginLocked(user.lockedUntil)) await recordLoginFailure(user.id);
    return null;
  }
  if (isLoginLocked(user.lockedUntil)) return null;
  if (user.status !== UserStatus.ACTIVE) return null;

  // Only privileged roles enroll here, and only if not already enrolled.
  if (!rolesRequireMfa(user.roleAssignments)) return null;
  if (user.mfaSecret) return null;

  return user;
}

export async function beginEnrollment(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const parsed = beginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    enrollmentToken: formData.get('enrollmentToken'),
  });
  if (!parsed.success) return { step: 'credentials', error: GENERIC };

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) return { step: 'credentials', error: GENERIC };
  if (!(await findValidMfaEnrollmentToken(user.id, parsed.data.enrollmentToken))) {
    return { step: 'credentials', error: GENERIC };
  }

  const secret = generateMfaSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaPendingSecret: secret },
  });

  const uri = buildMfaUri(secret, user.email ?? user.id);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });

  return {
    step: 'verify',
    qrDataUrl,
    manualKey: secret,
    email: parsed.data.email,
  };
}

const confirmSchema = beginSchema.extend({ totp: z.string().trim().regex(/^\d{6}$/) });

export async function confirmEnrollment(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const parsed = confirmSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    enrollmentToken: formData.get('enrollmentToken'),
    totp: formData.get('totp'),
  });
  if (!parsed.success) return { step: 'verify', error: 'Enter the 6-digit code.' };

  // Re-authenticate: a valid pending secret must never be promotable by
  // whoever happens to hit this endpoint next.
  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user?.mfaPendingSecret) return { step: 'credentials', error: GENERIC };

  const enrollmentToken = await findValidMfaEnrollmentToken(
    user.id,
    parsed.data.enrollmentToken,
  );
  if (!enrollmentToken) return { step: 'credentials', error: GENERIC };

  if (!verifyMfaToken(parsed.data.totp, user.mfaPendingSecret)) {
    await recordLoginFailure(user.id);
    return { step: 'verify', error: 'That code is not valid. Try the next one.' };
  }

  const consumed = await prisma.$transaction(async (tx) => {
    const result = await tx.mfaEnrollmentToken.updateMany({
      where: {
        id: enrollmentToken.id,
        userId: user.id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (result.count !== 1) return false;

    await tx.user.update({
      where: { id: user.id },
      data: {
        mfaSecret: user.mfaPendingSecret,
        mfaPendingSecret: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    await audit(tx, {
      actorUserId: user.id,
      actorRole: user.roleAssignments.map((r) => r.role).join(','),
      action: 'user.mfa_enrolled',
      resourceType: 'User',
      resourceId: user.id,
      metadata: { enrollmentTokenId: enrollmentToken.id },
    });
    return true;
  });

  if (!consumed) return { step: 'credentials', error: GENERIC };

  return { step: 'done' };
}
