'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { History } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { loadRevisionsAction } from './actions';
import type { RevisionView } from '@/lib/clinical/notes';

const REASON_LABEL: Record<string, { fr: string; ar: string }> = {
  CREATE: { fr: 'Création', ar: 'إنشاء' },
  EDIT: { fr: 'Modification', ar: 'تعديل' },
  RETRACT: { fr: 'Rétractation', ar: 'سحب' },
};

/** History dialog. Revisions are fetched on open — decrypted server-side, so
 *  ciphertext never sits in the initial page payload for notes not being viewed. */
export function RevisionHistory({ noteId, count }: { noteId: string; count: number }) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [revisions, setRevisions] = useState<RevisionView[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function open(isOpen: boolean) {
    if (!isOpen || revisions) return;
    setLoading(true);
    const result = await loadRevisionsAction(noteId);
    setRevisions(result.ok ? result.revisions : []);
    setLoading(false);
  }

  return (
    <Dialog onOpenChange={open}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600"
        >
          <History className="h-3.5 w-3.5" />
          {ar ? `السجل (${count})` : `Historique (${count})`}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ar ? 'سجل التعديلات' : 'Historique des modifications'}</DialogTitle>
          <DialogDescription>
            {ar
              ? 'كل نسخة محفوظة، الأحدث أولًا.'
              : 'Chaque version enregistrée, la plus récente en premier.'}
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-gray-500">…</p>}

        <ul className="max-h-96 space-y-3 overflow-y-auto">
          {revisions?.map((r) => (
            <li key={r.id} className="rounded border border-gray-100 bg-gray-50 p-3">
              <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                <span className="font-medium">
                  {REASON_LABEL[r.reason]?.[ar ? 'ar' : 'fr'] ?? r.reason}
                </span>
                <time dateTime={new Date(r.createdAt).toISOString()}>
                  {new Date(r.createdAt).toLocaleString(locale)}
                </time>
              </div>
              <p dir="auto" className="whitespace-pre-wrap text-sm text-gray-800">
                {r.content}
              </p>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
