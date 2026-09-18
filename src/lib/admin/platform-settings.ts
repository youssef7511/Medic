import { z } from 'zod';

export const PLATFORM_SETTINGS_ID = 'platform';

export const DEFAULT_PLATFORM_SETTINGS = {
  patientRegistrationEnabled: true,
  supportEmail: null as string | null,
  supportPhone: null as string | null,
};

const optionalEmail = z.preprocess(
  (value) => (value == null || (typeof value === 'string' && value.trim() === '') ? undefined : value),
  z.string().trim().email().optional(),
);

const optionalPhone = z.preprocess(
  (value) => (value == null || (typeof value === 'string' && value.trim() === '') ? undefined : value),
  z.string().trim().min(6).max(30).optional(),
);

export const platformSettingsInputSchema = z.object({
  patientRegistrationEnabled: z.boolean(),
  supportEmail: optionalEmail,
  supportPhone: optionalPhone,
});

export type PlatformSettingsInput = z.infer<typeof platformSettingsInputSchema>;

export function parsePlatformSettingsForm(formData: FormData): PlatformSettingsInput {
  return platformSettingsInputSchema.parse({
    patientRegistrationEnabled: formData.get('patientRegistrationEnabled') === 'on',
    supportEmail: formData.get('supportEmail'),
    supportPhone: formData.get('supportPhone'),
  });
}
