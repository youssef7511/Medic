'use client';

import { useActionState, useState } from 'react';
import { useLocale } from 'next-intl';
import { bookSlotAction, type BookFormState } from './actions';
import { CalendarCheck, CheckCircle2, Clock3 } from 'lucide-react';
import { Link } from '@/i18n/navigation';

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
      <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        <p className="mt-3 font-bold text-emerald-900">
          {locale === 'ar' ? 'تم إرسال طلب الموعد.' : 'Demande de rendez-vous envoyée.'}
        </p>
        <p className="mt-2 text-sm text-emerald-700">
          {locale === 'ar'
            ? 'سيؤكّد الطبيب موعدك قريبًا.'
            : 'Le médecin confirmera votre rendez-vous prochainement.'}
        </p><Link href="/p/appointments" className="mt-4 inline-flex rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">{locale === 'ar' ? 'عرض مواعيدي' : 'Voir mes rendez-vous'}</Link>
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
      <div className="py-8 text-center"><CalendarCheck className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 text-sm text-slate-500">
        {locale === 'ar'
          ? 'لا توجد مواعيد متاحة حاليًا.'
          : 'Aucun créneau disponible pour le moment.'}
      </p></div>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="doctorId" value={doctorId} />
      <input type="hidden" name="clinicId" value={clinicId} />
      <input type="hidden" name="startAt" value={selected ?? ''} />

      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(byDay).map(([day, daySlots]) => (
          <div key={day} className="rounded-2xl border border-slate-200 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold capitalize text-navy-950"><CalendarCheck className="h-4 w-4 text-brand-600" />{day}</h3>
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
                        ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:bg-brand-50')
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
        <label htmlFor="reason" className="medic-label">
          {locale === 'ar' ? 'سبب الزيارة (اختياري)' : 'Motif de la visite (facultatif)'}
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          maxLength={500}
          placeholder={locale === 'ar' ? 'صف بإيجاز سبب الموعد…' : 'Décrivez brièvement la raison du rendez-vous…'}
          className="medic-textarea"
        />
      </div>

      {state.status === 'error' && (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="flex items-center gap-2 text-xs text-slate-500"><Clock3 className="h-4 w-4" />{selected ? (locale === 'ar' ? 'تم اختيار موعد' : 'Créneau sélectionné') : (locale === 'ar' ? 'اختر موعدًا للمتابعة' : 'Sélectionnez un créneau pour continuer')}</p><button type="submit" disabled={pending || !selected} className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">{pending ? (locale === 'ar' ? 'جارٍ الإرسال…' : 'Envoi…') : (locale === 'ar' ? 'تأكيد الحجز' : 'Confirmer le rendez-vous')}</button></div>
    </form>
  );
}
