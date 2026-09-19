'use client';

import { useActionState } from 'react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { activateBreakGlassAction, type BreakGlassActionState } from './actions';

const initialState: BreakGlassActionState = {};

export function BreakGlassForm({ locale }: { locale: string }) {
  const ar = locale === 'ar';
  const [state, action, pending] = useActionState(activateBreakGlassAction, initialState);

  if (state.grantId) {
    return (
      <div className="rounded-2xl border-2 border-red-400 bg-red-50 p-5">
        <p className="font-semibold text-red-900">
          {ar ? 'تم تفعيل الوصول الطارئ وتم إشعار المريض.' : 'Accès d’urgence activé et notification patient programmée.'}
        </p>
        <Link className="mt-3 inline-block font-medium text-red-700 underline" href={`/admin/break-glass/${state.grantId}`}>
          {ar ? 'فتح الوصول المؤقت' : 'Ouvrir l’accès temporaire'}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="medic-panel space-y-5 border-red-200 p-5 sm:p-6">
      <div>
        <label htmlFor="patient" className="medic-label">
          {ar ? 'معرّف المريض أو البريد الإلكتروني' : 'Identifiant patient ou e-mail exact'}
        </label>
        <input id="patient" name="patient" required className="medic-input" />
      </div>
      <div>
        <label htmlFor="reason" className="medic-label">
          {ar ? 'سبب طارئ مفصل' : 'Justification d’urgence détaillée'}
        </label>
        <textarea id="reason" name="reason" required minLength={20} maxLength={500} rows={4} className="medic-textarea" />
      </div>
      <div>
        <label htmlFor="durationMinutes" className="medic-label">
          {ar ? 'المدة' : 'Durée'}
        </label>
        <select id="durationMinutes" name="durationMinutes" defaultValue="15" className="medic-input">
          <option value="5">5 min</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
        </select>
      </div>
      <div>
        <label htmlFor="totp" className="medic-label">Code MFA</label>
        <input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} className="medic-input text-center text-lg font-semibold tracking-[0.35em]" />
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? (ar ? 'جارٍ التفعيل…' : 'Activation…') : (ar ? 'تفعيل الوصول الطارئ' : 'Activer le break-glass')}
      </Button>
    </form>
  );
}
