'use server';

import { revalidatePath } from 'next/cache';
import { Role } from '@prisma/client';
import { ZodError } from 'zod';
import { audit } from '@/lib/audit';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import {
  parsePlatformSettingsForm,
  PLATFORM_SETTINGS_ID,
} from '@/lib/admin/platform-settings';

export type PlatformSettingsActionState = { ok?: boolean; error?: string };

export async function updatePlatformSettingsAction(
  _previous: PlatformSettingsActionState,
  formData: FormData,
): Promise<PlatformSettingsActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Session expirée.' };
  if (!hasPermission(actor, 'platform_settings:write')) {
    return { error: 'Permission refusée.' };
  }

  let input;
  try {
    input = parsePlatformSettingsForm(formData);
  } catch (error) {
    if (error instanceof ZodError) return { error: 'Paramètres invalides.' };
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.platformSettings.upsert({
      where: { id: PLATFORM_SETTINGS_ID },
      create: {
        id: PLATFORM_SETTINGS_ID,
        patientRegistrationEnabled: input.patientRegistrationEnabled,
        supportEmail: input.supportEmail ?? null,
        supportPhone: input.supportPhone ?? null,
        updatedByUserId: actor.userId,
      },
      update: {
        patientRegistrationEnabled: input.patientRegistrationEnabled,
        supportEmail: input.supportEmail ?? null,
        supportPhone: input.supportPhone ?? null,
        updatedByUserId: actor.userId,
      },
    });

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.SUPER_ADMIN,
      action: 'platform_settings.updated',
      resourceType: 'PlatformSettings',
      resourceId: PLATFORM_SETTINGS_ID,
      metadata: {
        patientRegistrationEnabled: input.patientRegistrationEnabled,
        supportEmailConfigured: Boolean(input.supportEmail),
        supportPhoneConfigured: Boolean(input.supportPhone),
      },
    });
  });

  revalidatePath('/admin/settings');
  return { ok: true };
}
