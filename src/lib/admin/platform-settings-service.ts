import { prisma } from '@/lib/db';
import {
  DEFAULT_PLATFORM_SETTINGS,
  PLATFORM_SETTINGS_ID,
} from './platform-settings';

export async function getPlatformSettings() {
  const stored = await prisma.platformSettings.findUnique({
    where: { id: PLATFORM_SETTINGS_ID },
    select: {
      patientRegistrationEnabled: true,
      supportEmail: true,
      supportPhone: true,
      updatedAt: true,
      updatedByUserId: true,
    },
  });

  return stored ?? {
    ...DEFAULT_PLATFORM_SETTINGS,
    updatedAt: null,
    updatedByUserId: null,
  };
}
