'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { issuePrescriptionAction, type PrescribeState } from './actions';
import { MAX_MEDICATION_LINES } from '@/lib/documents/prescriptions.validation';

interface Row {
  drug: string;
  dose: string;
  frequency: string;
  durationDays: string;
  instructions: string;
}

const emptyRow = (): Row => ({ drug: '', dose: '', frequency: '', durationDays: '', instructions: '' });

export function PrescribeForm({
  linkId,
  allergyRecorded,
}: {
  linkId: string;
  /** false when the patient's allergies are not_recorded — surfaced in the label. */
  allergyRecorded: boolean;
}) {
  const locale = useLocale();
  const ar = locale === 'ar';

  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [notes, setNotes] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [state, setState] = useState<PrescribeState>({});
  const [pending, setPending] = useState(false);

  const validRows = rows.filter((r) => r.drug.trim() && r.dose.trim());
  const canIssue = validRows.length > 0 && acknowledged && !pending;

  function update(i: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function submit() {
    setPending(true);
    setState({});
    const medications = validRows.map((r) => ({
      drug: r.drug.trim(),
      dose: r.dose.trim(),
      ...(r.frequency.trim() ? { frequency: r.frequency.trim() } : {}),
      ...(r.durationDays.trim() ? { durationDays: Number(r.durationDays) } : {}),
      ...(r.instructions.trim() ? { instructions: r.instructions.trim() } : {}),
    }));

    const fd = new FormData();
    fd.set('locale', locale);
    fd.set('linkId', linkId);
    fd.set('medications', JSON.stringify(medications));
    if (notes.trim()) fd.set('notes', notes.trim());
    fd.set('allergyAcknowledged', acknowledged ? 'true' : 'false');

    const result = await issuePrescriptionAction({}, fd);
    setPending(false);
    setState(result);
    if (result.ok) {
      setRows([emptyRow()]);
      setNotes('');
      setAcknowledged(false);
    }
  }

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <p className="font-medium text-green-800">
          {ar ? 'تم إصدار الوصفة.' : "L'ordonnance a été émise."}
        </p>
        <a
          href={`/api/documents/${state.documentId}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sm text-brand-600 hover:underline"
        >
          {ar ? 'فتح PDF' : 'Ouvrir le PDF'} →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(160px,1.4fr)_1fr_1fr_90px_auto]">
              <input
                value={row.drug}
                onChange={(e) => update(i, 'drug', e.target.value)}
                placeholder={ar ? 'الدواء *' : 'Médicament *'}
                className="h-10 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm"
              />
              <input
                value={row.dose}
                onChange={(e) => update(i, 'dose', e.target.value)}
                placeholder={ar ? 'الجرعة *' : 'Posologie *'}
                className="h-10 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm"
              />
              <input
                value={row.frequency}
                onChange={(e) => update(i, 'frequency', e.target.value)}
                placeholder={ar ? 'التواتر' : 'Fréquence'}
                className="h-10 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm"
              />
              <input
                value={row.durationDays}
                onChange={(e) => update(i, 'durationDays', e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder={ar ? 'أيام' : 'Jours'}
                className="h-10 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm"
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label={ar ? 'حذف' : 'Supprimer'}
                  className="grid h-10 w-10 place-items-center rounded-xl text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <input
              value={row.instructions}
              onChange={(e) => update(i, 'instructions', e.target.value)}
              placeholder={ar ? 'تعليمات' : 'Instructions'}
              className="mt-3 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
        ))}
      </div>

      {rows.length < MAX_MEDICATION_LINES && (
        <Button type="button" size="sm" variant="outline" onClick={() => setRows((p) => [...p, emptyRow()])}>
          <Plus className="h-4 w-4" />
          {ar ? 'دواء آخر' : 'Autre médicament'}
        </Button>
      )}

      <div>
        <label htmlFor="notes" className="medic-label">
          {ar ? 'ملاحظات' : 'Notes'}
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          dir="auto"
          className="medic-textarea"
        />
      </div>

      {/* The mandatory acknowledgment (§3.1). Its label reminds the doctor when
          the allergy state was never recorded. */}
      <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand-600"
        />
        <span>
          {ar ? 'أؤكّد أنني راجعت الحساسيات المعروفة.' : "Je confirme avoir examiné les allergies connues."}
          {!allergyRecorded && (
            <span className="mt-0.5 block text-amber-700">
              {ar
                ? '(غير مسجَّلة لهذا المريض.)'
                : '(Non renseignées pour ce patient.)'}
            </span>
          )}
        </span>
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <Button type="button" disabled={!canIssue} onClick={() => void submit()}>
        {pending ? (ar ? 'جارٍ الإصدار…' : 'Émission…') : ar ? 'إصدار الوصفة' : "Émettre l'ordonnance"}
      </Button>
    </div>
  );
}
