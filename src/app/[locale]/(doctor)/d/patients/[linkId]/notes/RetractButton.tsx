'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { retractNoteAction } from './actions';
import { RETRACTION_REASON_MIN_CHARS } from '@/lib/clinical/notes.validation';

/** Retracts a note. Deliberately a two-step dialog with a required reason —
 *  withdrawing a clinical record shouldn't be a single stray click, and the
 *  reason is the only trace of *why* it was withdrawn. */
export function RetractButton({ linkId, noteId }: { linkId: string; noteId: string }) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set('locale', locale);
    fd.set('linkId', linkId);
    fd.set('noteId', noteId);
    fd.set('reason', reason);
    const result = await retractNoteAction({}, fd);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-red-600 hover:underline"
      >
        {ar ? 'سحب' : 'Rétracter'}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ar ? 'سحب الملاحظة' : 'Rétracter la note'}</DialogTitle>
            <DialogDescription>
              {ar
                ? 'لن تُحذف الملاحظة، بل تُوسم كمُدخلة بالخطأ مع الاحتفاظ بسجلها.'
                : "La note n'est pas supprimée : elle est marquée « saisie par erreur » et son historique est conservé."}
            </DialogDescription>
          </DialogHeader>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">{ar ? 'السبب' : 'Motif'}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              dir="auto"
              minLength={RETRACTION_REASON_MIN_CHARS}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {ar ? 'إلغاء' : 'Annuler'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || reason.trim().length < RETRACTION_REASON_MIN_CHARS}
              onClick={() => void submit()}
            >
              {ar ? 'تأكيد السحب' : 'Confirmer la rétractation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
