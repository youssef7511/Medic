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
import { revokeDocumentAction } from '../prescribe/actions';
import { REVOKE_REASON_MIN_CHARS } from '@/lib/documents/prescriptions.validation';

/** Two-step revoke with a required reason — voiding a prescription a pharmacy
 *  might honour shouldn't be a single stray click. */
export function RevokeDocumentButton({ linkId, documentId }: { linkId: string; documentId: string }) {
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
    fd.set('documentId', documentId);
    fd.set('reason', reason);
    const result = await revokeDocumentAction({}, fd);
    setPending(false);
    if (result.error) return setError(result.error);
    setOpen(false);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-red-600 hover:underline">
        {ar ? 'إلغاء' : 'Annuler'}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ar ? 'إلغاء الوصفة' : "Annuler l'ordonnance"}</DialogTitle>
            <DialogDescription>
              {ar
                ? 'لن تُحذف الوصفة، بل تُوسم كملغاة مع الاحتفاظ بها في السجل.'
                : "L'ordonnance n'est pas supprimée : elle est marquée annulée et conservée dans le dossier."}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            dir="auto"
            placeholder={ar ? 'السبب' : 'Motif'}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {ar ? 'تراجع' : 'Retour'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || reason.trim().length < REVOKE_REASON_MIN_CHARS}
              onClick={() => void submit()}
            >
              {ar ? 'تأكيد الإلغاء' : "Confirmer l'annulation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
