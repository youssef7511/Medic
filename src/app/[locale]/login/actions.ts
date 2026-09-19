'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Role, ScopeType, Sex } from '@prisma/client';
import { signIn } from '@/auth';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { safeNextPath } from '@/lib/auth/redirects';
import { audit } from '@/lib/audit';
import { GLOBAL_SCOPE_ID } from '@/lib/admin/role-assignment';
import { getPlatformSettings } from '@/lib/admin/platform-settings-service';
import { LOGIN_PORTALS, portalLanding, portalOwnsPath } from '@/lib/auth/portals';

export type AuthFormState = {
  error?:
    | 'invalid'
    | 'mfa_required'
    | 'mfa_enrollment_required'
    | 'account_suspended'
    | 'registration_disabled';
  email?: string;
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().trim().optional(),
  portal: z.enum(LOGIN_PORTALS),
});

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const locale = String(formData.get('locale') ?? 'fr');
  const rawNext = String(formData.get('next') ?? '');

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    totp: formData.get('totp') || undefined,
    portal: formData.get('portal') || undefined,
  });
  if (!parsed.success) return { error: 'invalid' };

  try {
    await signIn('credentials', { ...parsed.data, redirect: false });
  } catch (e) {
    // Auth.js surfaces our custom codes here. Anything else is a generic
    // failure — we never distinguish "no such user" from "wrong password".
    const code = (e as { code?: string })?.code;
    if (code === 'mfa_required') return { error: 'mfa_required', email: parsed.data.email };
    if (code === 'mfa_enrollment_required') {
      return { error: 'mfa_enrollment_required', email: parsed.data.email };
    }
    if (code === 'account_suspended') return { error: 'account_suspended' };
    return { error: 'invalid', email: parsed.data.email };
  }

  // Stay inside the selected portal even when `next` names another protected
  // space; the credentials provider already proved that this role is allowed.
  const landing = portalLanding(parsed.data.portal, locale);

  const safeDestination = safeNextPath(rawNext, locale, landing);
  const destination = !portalOwnsPath(parsed.data.portal, safeDestination, locale)
    ? landing
    : safeDestination;

  redirect(destination);
}

const registerSchema = z.object({
  email: z.string().email(),
  // Length beats composition rules; NIST dropped the character-class theatre.
  password: z.string().min(10, 'Password must be at least 10 characters'),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().min(6),
  dateOfBirth: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date'),
  sex: z.nativeEnum(Sex),
});

/**
 * Patient self-registration. Creates User + PatientProfile + the PATIENT role
 * in one transaction — a half-created account with no profile would break
 * every downstream assumption.
 *
 * Doctors are NOT self-service: a doctor account is created by an admin and
 * stays unpublished until a human verifies the licence (§10).
 */
export async function registerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const locale = String(formData.get('locale') ?? 'fr');
  // Self-registration always creates a PATIENT, so /p is the correct default.
  const next = safeNextPath(String(formData.get('next') ?? ''), locale, `/${locale}/p`);

  const parsed = registerSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    phone: formData.get('phone'),
    dateOfBirth: formData.get('dateOfBirth'),
    sex: formData.get('sex'),
  });
  if (!parsed.success) return { error: 'invalid' };

  const settings = await getPlatformSettings();
  if (!settings.patientRegistrationEnabled) {
    return { error: 'registration_disabled' };
  }

  const data = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email: data.email } });

  // Don't confirm that an address is already registered — that's an account
  // enumeration oracle on a medical platform (§10). Fall through to the generic
  // error the same way a malformed submission would.
  if (existing) return { error: 'invalid', email: data.email };

  const passwordHash = await hashPassword(data.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: data.email,
        phone: data.phone,
        passwordHash,
        locale,
        patientProfile: {
          create: {
            firstName: data.firstName,
            lastName: data.lastName,
            dateOfBirth: new Date(data.dateOfBirth),
            sex: data.sex,
            phone: data.phone,
          },
        },
        roleAssignments: {
          create: {
            role: Role.PATIENT,
            scopeType: ScopeType.GLOBAL,
            scopeId: GLOBAL_SCOPE_ID,
            grantedBy: 'self-registration',
          },
        },
      },
    });

    await audit(tx, {
      actorUserId: created.id,
      actorRole: Role.PATIENT,
      action: 'user.register',
      resourceType: 'User',
      resourceId: created.id,
    });

    return created;
  });

  await signIn('credentials', {
    email: data.email,
    password: data.password,
    portal: 'patient',
    redirect: false,
  });

  void user;
  redirect(next);
}
