'use client';

import { useActionState } from 'react';
import { appointmentAction, type DoctorActionState } from './actions';

const initial: DoctorActionState = {};

interface Props {
  appointmentId: string;
  status: string;
  isPast: boolean;
  locale: string;
}

export function AppointmentActions({ appointmentId, status, isPast, locale }: Props) {
  const [state, formAction, pending] = useActionState(appointmentAction, initial);
  const ar = locale === 'ar';

  // Offer only transitions the server would actually accept (state.ts).
  const options: { action: string; label: string; style: string }[] = [];

  if (status === 'REQUESTED' && !isPast) {
    options.push({
      action: 'confirm',
      label: ar ? 'تأكيد' : 'Confirmer',
      style: 'bg-brand-500 text-white hover:bg-brand-600',
    });
    options.push({
      action: 'decline',
      label: ar ? 'رفض' : 'Refuser',
      style: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    });
  }

  if (status === 'CONFIRMED' && !isPast) {
    options.push({
      action: 'decline',
      label: ar ? 'إلغاء' : 'Annuler',
      style: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    });
  }

  // NO_SHOW and COMPLETE are statements about the past, so they only appear
  // once the appointment has actually started.
  if (status === 'CONFIRMED' && isPast) {
    options.push({
      action: 'complete',
      label: ar ? 'تم الحضور' : 'Honoré',
      style: 'bg-brand-500 text-white hover:bg-brand-600',
    });
    options.push({
      action: 'no_show',
      label: ar ? 'لم يحضر' : 'Absent',
      style: 'border border-red-300 text-red-700 hover:bg-red-50',
    });
  }

  if (options.length === 0) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {options.map((o) => (
          <form key={o.action} action={formAction}>
            <input type="hidden" name="appointmentId" value={appointmentId} />
            <input type="hidden" name="action" value={o.action} />
            <button
              type="submit"
              disabled={pending}
              className={`rounded px-3 py-1 text-sm disabled:opacity-60 ${o.style}`}
            >
              {o.label}
            </button>
          </form>
        ))}
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </div>
  );
}
