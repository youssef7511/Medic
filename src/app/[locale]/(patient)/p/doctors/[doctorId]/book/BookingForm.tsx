'use client';

import { useActionState, useState } from 'react';
import { useLocale } from 'next-intl';
import { bookSlotAction, type BookFormState } from './actions';

export interface SlotView {
  /** ISO UTC instant — the value actually submitted. */
  startAt: string;
  /** Pre-formatted in the doctor's timezone on the server (§6). */
  dayLabel: string;
  timeLabel: string;
}

const initial: BookFormState = { status: 'idle' };

export function BookingForm({
  doctorId,
  clinicId,
  slots,
}: {
  doctorId: string;
  clinicId: string;
  slots: SlotView[];
}) {
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(bookSlotAction, initial);
  const [selected, setSelected] = useState<string | null>(null);

  if (state.status === 'booked') {
    return (
      <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="font-medium text-green-800">
          {locale === 'ar' ? 'تم إرسال طلب الموعد.' : 'Demande de rendez-vous envoyée.'}
        </p>
        <p className="mt-1 text-sm text-green-700">
          {locale === 'ar'
            ? 'سيؤكّد الطبيب موعدك قريبًا.'
            : 'Le médecin confirmera votre rendez-vous prochainement.'}
        </p>
      </div>
    );
  }

  // Group by day for a calendar-ish read rather than one long list.
  const byDay = slots.reduce<Record<string, SlotView[]>>((acc, s) => {
    (acc[s.dayLabel] ??= []).push(s);
    return acc;
  }, {});

  if (slots.length === 0) {
    return (
      <p className="text-gray-500">
        {locale === 'ar'
          ? 'لا توجد مواعيد متاحة حاليًا.'
          : 'Aucun créneau disponible pour le moment.'}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="doctorId" value={doctorId} />
      <input type="hidden" name="clinicId" value={clinicId} />
      <input type="hidden" name="startAt" value={selected ?? ''} />

      <div className="space-y-5">
        {Object.entries(byDay).map(([day, daySlots]) => (
          <div key={day}>
            <h3 className="text-sm font-medium text-gray-700">{day}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {daySlots.map((s) => {
                const isSelected = selected === s.startAt;
                return (
                  <button
                    key={s.startAt}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelected(s.startAt)}
                    className={
                      'rounded border px-3 py-1.5 text-sm ' +
                      (isSelected
                        ? 'border-brand-600 bg-brand-500 text-white'
                        : 'border-gray-300 bg-white hover:border-brand-500')
                    }
                  >
                    {s.timeLabel}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div>
        <label htmlFor="reason" className="block text-sm font-medium">
          {locale === 'ar' ? 'سبب الزيارة (اختياري)' : 'Motif de la visite (facultatif)'}
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          maxLength={500}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>

      {state.status === 'error' && (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !selected}
        className="rounded bg-brand-500 px-5 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {locale === 'ar' ? 'تأكيد الحجز' : 'Confirmer le rendez-vous'}
      </button>
    </form>
  );
}
