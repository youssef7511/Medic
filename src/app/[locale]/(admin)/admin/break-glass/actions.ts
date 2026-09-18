'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getCurrentActor } from '@/lib/auth/session';
import {
  activateBreakGlass,
  BreakGlassValidationError,
  revokeBreakGlass,
} from '@/lib/break-glass/access';
import { PermissionDeniedError, ResourceNotFoundError } from '@/lib/rbac/guard';

export type BreakGlassActionState = { error?: string; grantId?: string };

export async function activateBreakGlassAction(
  _previous: BreakGlassActionState,
  formData: FormData,
): Promise<BreakGlassActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Session expirée.' };

  const patientRef = String(formData.get('patient') ?? '').trim();
  const reason = String(formData.get('reason') ?? '');
  const totp = String(formData.get('totp') ?? '').trim();
  const durationMinutes = Number(formData.get('durationMinutes'));
  if (!patientRef) return { error: 'Patient requis.' };

  const patient = await prisma.patientProfile.findFirst({
    where: {
      OR: [{ id: patientRef }, { user: { email: patientRef.toLowerCase() } }],
    },
    select: { id: true },
  });
  if (!patient) return { error: 'Patient introuvable.' };

  try {
    const grant = await activateBreakGlass(actor, {
      patientId: patient.id,
      reason,
      totp,
      durationMinutes,
    });
    revalidatePath('/admin/break-glass');
    return { grantId: grant.id };
  } catch (error) {
    if (error instanceof BreakGlassValidationError) {
      return {
        error:
          error.code === 'totp'
            ? 'Code MFA invalide.'
            : 'La justification doit contenir 20 à 500 caractères et la durée 5 à 30 minutes.',
      };
    }
    if (error instanceof PermissionDeniedError || error instanceof ResourceNotFoundError) {
      return { error: 'Accès refusé.' };
    }
    throw error;
  }
}

export async function revokeBreakGlassAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) return;
  const grantId = String(formData.get('grantId') ?? '');
  if (!grantId) return;
  try {
    await revokeBreakGlass(actor, grantId);
    revalidatePath('/admin/break-glass');
    revalidatePath(`/admin/break-glass/${grantId}`);
  } catch (error) {
    if (!(error instanceof ResourceNotFoundError)) throw error;
  }
}
