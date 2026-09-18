'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  updatePlatformSettingsAction,
  type PlatformSettingsActionState,
} from './actions';

const initialState: PlatformSettingsActionState = {};

export function PlatformSettingsForm({
  locale,
  canWrite,
  settings,
}: {
  locale: string;
  canWrite: boolean;
  settings: {
    patientRegistrationEnabled: boolean;
    supportEmail: string | null;
    supportPhone: string | null;
  };
}) {
  const ar = locale === 'ar';
  const [state, action, pending] = useActionState(updatePlatformSettingsAction, initialState);

  return (
    <form action={action} className="space-y-5 rounded-lg border border-gray-200 bg-white p-5">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="patientRegistrationEnabled"
          defaultChecked={settings.patientRegistrationEnabled}
          disabled={!canWrite}
          className="mt-1"
        />
        <span>
          <span className="block text-sm font-medium">
            {ar ? 'السماح بتسجيل المرضى' : 'Autoriser l’inscription des patients'}
          </span>
          <span className="block text-xs text-gray-500">
            {ar
              ? 'عند التعطيل، ترفض الخادم طلبات إنشاء حسابات المرضى.'
              : 'Si désactivé, le serveur refuse toute création de compte patient.'}
          </span>
        </span>
      </label>

      <div>
        <label htmlFor="supportEmail" className="block text-sm font-medium">Email support</label>
        <input
          id="supportEmail"
          name="supportEmail"
          type="email"
          defaultValue={settings.supportEmail ?? ''}
          disabled={!canWrite}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-50"
        />
      </div>

      <div>
        <label htmlFor="supportPhone" className="block text-sm font-medium">
          {ar ? 'هاتف الدعم' : 'Téléphone support'}
        </label>
        <input
          id="supportPhone"
          name="supportPhone"
          type="tel"
          defaultValue={settings.supportPhone ?? ''}
          disabled={!canWrite}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-50"
        />
      </div>

      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-700">{ar ? 'تم الحفظ.' : 'Paramètres enregistrés.'}</p>}

      {canWrite && (
        <Button type="submit" disabled={pending}>
          {pending ? (ar ? 'جارٍ الحفظ…' : 'Enregistrement…') : (ar ? 'حفظ' : 'Enregistrer')}
        </Button>
      )}
    </form>
  );
}
