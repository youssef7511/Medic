'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { createNoteAction, updateNoteAction, type NoteActionState } from './actions';
import { AUTOSAVE_DEBOUNCE_MS, NOTE_MAX_CHARS } from '@/lib/clinical/notes.validation';

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/**
 * Writes a new note, or edits an existing one with debounced autosave.
 *
 * Drafts live only in component state and on the server (§10) — never in
 * localStorage, which would leave plaintext clinical text on a clinic's shared
 * machine after logout. Autosave posts to the server; the server-side coalescing
 * rule decides whether each post becomes a revision.
 */
export function NoteEditor({
  linkId,
  appointmentId,
  existing,
  onDone,
}: {
  linkId: string;
  appointmentId?: string;
  existing?: { id: string; content: string; updatedAt: string };
  onDone?: () => void;
}) {
  const locale = useLocale();
  const ar = locale === 'ar';

  const [content, setContent] = useState(existing?.content ?? '');
  const [noteId, setNoteId] = useState(existing?.id ?? null);
  const [updatedAt, setUpdatedAt] = useState(existing?.updatedAt ?? null);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(content);
  latest.current = content;

  const post = useCallback(
    async (explicit: boolean) => {
      const text = latest.current;
      if (text.trim().length === 0) return; // don't autosave an empty draft
      setState('saving');
      setError(null);

      const fd = new FormData();
      fd.set('locale', locale);
      fd.set('linkId', linkId);
      fd.set('content', text);

      let result: NoteActionState;
      if (noteId) {
        fd.set('noteId', noteId);
        fd.set('explicit', explicit ? 'true' : 'false');
        if (updatedAt) fd.set('expectedUpdatedAt', updatedAt);
        result = await updateNoteAction({}, fd);
      } else {
        if (appointmentId) fd.set('appointmentId', appointmentId);
        result = await createNoteAction({}, fd);
      }

      if (result.error) {
        setState('error');
        setError(result.error);
        return;
      }
      if (result.note) {
        setNoteId(result.note.id);
        setUpdatedAt(result.note.updatedAt as unknown as string);
      }
      setState(result.conflict ? 'conflict' : 'saved');
      if (explicit && onDone) onDone();
    },
    [appointmentId, linkId, locale, noteId, onDone, updatedAt],
  );

  // Debounced autosave on every change.
  useEffect(() => {
    if (content.trim().length === 0) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void post(false), AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // Intentionally keyed on content only — post is stable enough for a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const remaining = NOTE_MAX_CHARS - content.length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={NOTE_MAX_CHARS}
        rows={6}
        dir="auto"
        placeholder={ar ? 'اكتب ملاحظة الاستشارة…' : 'Rédigez la note de consultation…'}
        className="w-full resize-y rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />

      <div className="mt-2 flex items-center justify-between gap-3 text-xs">
        <span aria-live="polite" className="text-gray-500">
          {state === 'saving' && (ar ? 'جارٍ الحفظ…' : 'Enregistrement…')}
          {state === 'saved' && (ar ? 'محفوظ' : 'Enregistré')}
          {state === 'conflict' &&
            (ar
              ? 'حُفظ — لكن عُدّلت الملاحظة في مكان آخر.'
              : 'Enregistré — mais la note a été modifiée ailleurs.')}
          {state === 'error' && <span className="text-red-600">{error}</span>}
        </span>
        <span className={remaining < 500 ? 'text-amber-600' : 'text-gray-400'}>
          {remaining}
        </span>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            {ar ? 'إغلاق' : 'Fermer'}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          disabled={content.trim().length === 0 || state === 'saving'}
          onClick={() => void post(true)}
        >
          {ar ? 'حفظ' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  );
}
