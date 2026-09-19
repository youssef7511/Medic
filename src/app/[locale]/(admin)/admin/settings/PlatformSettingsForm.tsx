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
    <form action={action} className="medic-panel space-y-6 p-5 sm:p-6">
      <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4">
        <input
          type="checkbox"
          name="patientRegistrationEnabled"
          defaultChecked={settings.patientRegistrationEnabled}
          disabled={!canWrite}
          className="mt-1 h-4 w-4 accent-brand-600"
        />
        <span>
          <span className="block text-sm font-semibold text-navy-950">
            {ar ? 'السماح بتسجيل المرضى' : 'Autoriser l’inscription des patients'}
          </span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            {ar
              ? 'عند التعطيل، ترفض الخادم طلبات إنشاء حسابات المرضى.'
              : 'Si désactivé, le serveur refuse toute création de compte patient.'}
          </span>
        </span>
      </label>

      <div>
        <label htmlFor="supportEmail" className="medic-label">Email support</label>
        <input
          id="supportEmail"
          name="supportEmail"
          type="email"
          defaultValue={settings.supportEmail ?? ''}
          disabled={!canWrite}
          className="medic-input"
        />
      </div>

      <div>
        <label htmlFor="supportPhone" className="medic-label">
          {ar ? 'هاتف الدعم' : 'Téléphone support'}
        </label>
        <input
          id="supportPhone"
          name="supportPhone"
          type="tel"
          defaultValue={settings.supportPhone ?? ''}
          disabled={!canWrite}
          className="medic-input"
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
