'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { encryptText } from '@/lib/crypto/envelope';
import { auditNow } from '@/lib/audit';

export type AllergyState = { error?: string; ok?: boolean };

const schema = z.object({
  affirmedNone: z.enum(['true', 'false']),
  text: z.string().optional(),
});

/**
 * Patient records their own drug allergies (§3.1). This is the write side of
 * the safety loop — without it the prescribing screen could only ever say "not
 * recorded". `affirmedNone` and free text are mutually exclusive: affirming
 * "none" clears any text, so the two states can't contradict.
 */
export async function saveAllergiesAction(
  _prev: AllergyState,
  formData: FormData,
): Promise<AllergyState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };
  if (!hasPermission(actor, 'allergy:write:own')) return { error: 'Not permitted.' };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid input.' };

  const affirmedNone = parsed.data.affirmedNone === 'true';
  const text = parsed.data.text?.trim() ?? '';

  if (!affirmedNone && text.length === 0) {
    return { error: 'Enter your allergies, or confirm you have none.' };
  }
  if (text.length > 2000) return { error: 'Too long.' };

  const profile = await prisma.patientProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (!profile) return { error: 'No patient profile.' };

  await prisma.patientProfile.update({
    where: { id: profile.id },
    data: {
      // Affirming "none" wins and clears text; otherwise store the encrypted text.
      allergiesEnc: affirmedNone || text.length === 0 ? null : await encryptText(text),
      allergiesAffirmedNone: affirmedNone,
      allergiesUpdatedAt: new Date(),
    },
  });

  await auditNow({
    actorUserId: actor.userId,
    actorRole: Role.PATIENT,
    action: 'allergy.update',
    resourceType: 'PatientProfile',
    resourceId: profile.id,
    patientId: profile.id,
    metadata: { affirmedNone },
  });

  revalidatePath('/p/allergies');
  return { ok: true };
}
