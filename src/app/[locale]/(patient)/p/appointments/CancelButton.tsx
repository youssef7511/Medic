'use client';

import { useActionState, useState } from 'react';
import { cancelAppointmentAction, type CancelState } from './actions';

const initial: CancelState = {};

export function CancelButton({ appointmentId, locale }: { appointmentId: string; locale: string }) {
  const [state, formAction, pending] = useActionState(cancelAppointmentAction, initial);
  const [confirming, setConfirming] = useState(false);

  const ar = locale === 'ar';

  if (state.ok) {
    return <span className="text-sm text-gray-500">{ar ? 'تم الإلغاء' : 'Annulé'}</span>;
  }

  // Two-step: cancelling a medical appointment shouldn't be a single stray tap.
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-red-600 hover:underline"
      >
        {ar ? 'إلغاء' : 'Annuler'}
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <input
        name="reason"
        placeholder={ar ? 'السبب (اختياري)' : 'Motif (facultatif)'}
        maxLength={500}
        className="w-48 rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-sm text-gray-500 hover:underline"
        >
          {ar ? 'تراجع' : 'Retour'}
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 disabled:opacity-60"
        >
          {pending ? '…' : ar ? 'تأكيد الإلغاء' : "Confirmer l'annulation"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
