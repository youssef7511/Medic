'use client';

import { useActionState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  createRuleAction,
  deleteRuleAction,
  upsertExceptionAction,
  deleteExceptionAction,
  type AvailabilityState,
} from './actions';

const initial: AvailabilityState = {};

export interface RuleView {
  id: string;
  weekday: number;
  startLocal: string;
  endLocal: string;
  slotMinutes: number;
  clinicName: string;
}

export interface ExceptionView {
  id: string;
  date: string;
  isClosed: boolean;
  startLocal: string | null;
  endLocal: string | null;
}

// 0 = Sunday, matching the schema convention.
const DAY_NAMES: Record<string, string[]> = {
  fr: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  ar: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};
// Display order runs Monday-first to match the calendar grid.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function AvailabilityEditor({
  rules,
  exceptions,
  clinics,
  locale,
}: {
  rules: RuleView[];
  exceptions: ExceptionView[];
  clinics: { id: string; name: string }[];
  locale: string;
}) {
  const [createState, createFormAction, creating] = useActionState(createRuleAction, initial);
  const [deleteState, deleteFormAction] = useActionState(deleteRuleAction, initial);
  const [excState, excFormAction, excPending] = useActionState(upsertExceptionAction, initial);
  const [, delExcAction] = useActionState(deleteExceptionAction, initial);

  const ar = locale === 'ar';
  const days = DAY_NAMES[ar ? 'ar' : 'fr']!;

  if (clinics.length === 0) {
    return (
      <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {ar
          ? 'أضف عيادة أولًا قبل تحديد ساعات العمل.'
          : "Ajoutez d'abord un cabinet avant de définir vos horaires."}
      </p>
    );
  }

  return (
    <div className="space-y-10">
      {/* ------------------------------------------------ weekly recurring hours */}
      <section>
        <h2 className="text-lg font-semibold">
          {ar ? 'ساعات العمل الأسبوعية' : 'Horaires hebdomadaires'}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {ar
            ? 'تتكرر كل أسبوع. تُحسب المواعيد من هذه الفترات.'
            : 'Répétés chaque semaine. Les créneaux en sont dérivés.'}
        </p>

        <div className="mt-4 space-y-6">
          {DISPLAY_ORDER.map((weekday) => {
            const dayRules = rules.filter((r) => r.weekday === weekday);
            return (
              <div key={weekday} className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-medium text-gray-900">{days[weekday]}</h3>

                {dayRules.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-400">
                    {ar ? 'مغلق' : 'Fermé'}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {dayRules.map((rule) => (
                      <li
                        key={rule.id}
                        className="flex items-center justify-between rounded bg-gray-50 px-3 py-2 text-sm"
                      >
                        <span className="tabular-nums">
                          {rule.startLocal} – {rule.endLocal}
                          <span className="ms-3 text-gray-500">
                            {rule.slotMinutes} min · {rule.clinicName}
                          </span>
                        </span>
                        <form action={deleteFormAction}>
                          <input type="hidden" name="ruleId" value={rule.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            aria-label={ar ? 'حذف' : 'Supprimer'}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}

                <form action={createFormAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="weekday" value={weekday} />

                  <label className="text-xs text-gray-600">
                    {ar ? 'من' : 'De'}
                    <input
                      name="startLocal"
                      type="time"
                      required
                      defaultValue="09:00"
                      className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-600">
                    {ar ? 'إلى' : 'À'}
                    <input
                      name="endLocal"
                      type="time"
                      required
                      defaultValue="12:00"
                      className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-600">
                    {ar ? 'مدة الموعد' : 'Durée'}
                    <select
                      name="slotMinutes"
                      defaultValue="30"
                      className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      {[10, 15, 20, 30, 45, 60].map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-gray-600">
                    {ar ? 'العيادة' : 'Cabinet'}
                    <select
                      name="clinicId"
                      className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      {clinics.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <Button type="submit" size="sm" variant="outline" disabled={creating}>
                    <Plus className="h-4 w-4" />
                    {ar ? 'إضافة' : 'Ajouter'}
                  </Button>
                </form>
              </div>
            );
          })}
        </div>

        {createState.error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {createState.error}
          </p>
        )}
        {deleteState.error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {deleteState.error}
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------ exceptions */}
      <section>
        <h2 className="text-lg font-semibold">{ar ? 'استثناءات' : 'Exceptions'}</h2>
        <p className="mt-1 text-sm text-gray-500">
          {ar
            ? 'أيام العطل أو ساعات استثنائية. تتجاوز الجدول الأسبوعي.'
            : 'Congés ou horaires ponctuels. Priment sur les horaires hebdomadaires.'}
        </p>

        <form
          action={excFormAction}
          className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-4"
        >
          <label className="text-xs text-gray-600">
            {ar ? 'التاريخ' : 'Date'}
            <input
              name="date"
              type="date"
              required
              className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input name="isClosed" type="checkbox" defaultChecked className="rounded" />
            {ar ? 'مغلق طوال اليوم' : 'Fermé toute la journée'}
          </label>
          <label className="text-xs text-gray-600">
            {ar ? 'من (اختياري)' : 'De (optionnel)'}
            <input
              name="startLocal"
              type="time"
              className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            {ar ? 'إلى (اختياري)' : 'À (optionnel)'}
            <input
              name="endLocal"
              type="time"
              className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={excPending}>
            {ar ? 'حفظ' : 'Enregistrer'}
          </Button>
        </form>

        {excState.error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {excState.error}
          </p>
        )}

        {exceptions.length > 0 && (
          <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {exceptions.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="tabular-nums">
                  {e.date}
                  <span className="ms-3 text-gray-500">
                    {e.isClosed
                      ? ar
                        ? 'مغلق'
                        : 'Fermé'
                      : `${e.startLocal ?? ''} – ${e.endLocal ?? ''}`}
                  </span>
                </span>
                <form action={delExcAction}>
                  <input type="hidden" name="exceptionId" value={e.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label={ar ? 'حذف' : 'Supprimer'}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
