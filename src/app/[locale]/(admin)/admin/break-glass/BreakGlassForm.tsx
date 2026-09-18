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
      <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4">
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
    <form action={action} className="space-y-4 rounded-lg border-2 border-red-300 bg-white p-5">
      <div>
        <label htmlFor="patient" className="block text-sm font-medium">
          {ar ? 'معرّف المريض أو البريد الإلكتروني' : 'Identifiant patient ou e-mail exact'}
        </label>
        <input id="patient" name="patient" required className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="reason" className="block text-sm font-medium">
          {ar ? 'سبب طارئ مفصل' : 'Justification d’urgence détaillée'}
        </label>
        <textarea id="reason" name="reason" required minLength={20} maxLength={500} rows={4} className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="durationMinutes" className="block text-sm font-medium">
          {ar ? 'المدة' : 'Durée'}
        </label>
        <select id="durationMinutes" name="durationMinutes" defaultValue="15" className="mt-1 w-full rounded border px-3 py-2">
          <option value="5">5 min</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
        </select>
      </div>
      <div>
        <label htmlFor="totp" className="block text-sm font-medium">Code MFA</label>
        <input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" className="mt-1 w-full rounded border px-3 py-2 tracking-widest" />
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? (ar ? 'جارٍ التفعيل…' : 'Activation…') : (ar ? 'تفعيل الوصول الطارئ' : 'Activer le break-glass')}
      </Button>
    </form>
  );
}
