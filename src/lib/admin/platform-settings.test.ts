import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlatformSettingsForm, platformSettingsInputSchema } from './platform-settings';

test('platform contact fields are normalized and validated', () => {
  assert.deepEqual(
    platformSettingsInputSchema.parse({
      patientRegistrationEnabled: true,
      supportEmail: ' admin@example.com ',
      supportPhone: ' +216 70 000 000 ',
    }),
    {
      patientRegistrationEnabled: true,
      supportEmail: 'admin@example.com',
      supportPhone: '+216 70 000 000',
    },
  );
  assert.equal(
    platformSettingsInputSchema.safeParse({
      patientRegistrationEnabled: true,
      supportEmail: 'not-an-email',
    }).success,
    false,
  );
});

test('unchecked registration and empty contacts produce safe values', () => {
  const form = new FormData();
  form.set('supportEmail', '');
  form.set('supportPhone', '');
  assert.deepEqual(parsePlatformSettingsForm(form), {
    patientRegistrationEnabled: false,
    supportEmail: undefined,
    supportPhone: undefined,
  });
});
