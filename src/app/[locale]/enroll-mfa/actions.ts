'use server';

import { z } from 'zod';
import QRCode from 'qrcode';
import { UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { verifyPassword, fakeVerify } from '@/lib/auth/password';
import { buildMfaUri, generateMfaSecret, rolesRequireMfa, verifyMfaToken } from '@/lib/auth/totp';
import { auditNow } from '@/lib/audit';

/**
 * First-login 2FA enrollment for privileged accounts (§10).
 *
 * Without this a doctor account is unusable: login refuses an un-enrolled
 * privileged user, and there was previously no way to enroll.
 *
 * TODO(security): enrollment currently authenticates with the password alone.
 * If a doctor's password leaks BEFORE they enroll, an attacker can bind their
 * own authenticator. The hardening is an admin-issued single-use enrollment
 * token handed over out-of-band, which fits naturally with the Phase 6 admin
 * onboarding queue — until then, treat initial password delivery as sensitive.
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
  if (!(await verifyPassword(password, user.passwordHash))) return null;
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
  });
  if (!parsed.success) return { step: 'credentials', error: GENERIC };

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) return { step: 'credentials', error: GENERIC };

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

const confirmSchema = beginSchema.extend({ totp: z.string().trim().min(6) });

export async function confirmEnrollment(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const parsed = confirmSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    totp: formData.get('totp'),
  });
  if (!parsed.success) return { step: 'verify', error: 'Enter the 6-digit code.' };

  // Re-authenticate: a valid pending secret must never be promotable by
  // whoever happens to hit this endpoint next.
  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user?.mfaPendingSecret) return { step: 'credentials', error: GENERIC };

  if (!verifyMfaToken(parsed.data.totp, user.mfaPendingSecret)) {
    return { step: 'verify', error: 'That code is not valid. Try the next one.' };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null },
  });

  await auditNow({
    actorUserId: user.id,
    actorRole: user.roleAssignments.map((r) => r.role).join(','),
    action: 'user.mfa_enrolled',
    resourceType: 'User',
    resourceId: user.id,
  });

  return { step: 'done' };
}
