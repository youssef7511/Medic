'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NoteEditor } from './NoteEditor';
import { RevisionHistory } from './RevisionHistory';
import { RetractButton } from './RetractButton';

export interface JournalNote {
  id: string;
  content: string;
  status: 'ACTIVE' | 'RETRACTED';
  retractReason: string | null;
  createdAt: string;
  updatedAt: string;
  revisionCount: number;
}

export function NotesJournal({
  linkId,
  notes,
  showRetracted,
}: {
  linkId: string;
  notes: JournalNote[];
  showRetracted: boolean;
}) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {!composing ? (
        <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
          <Plus className="h-4 w-4" />
          {ar ? 'ملاحظة جديدة' : 'Nouvelle note'}
        </Button>
      ) : (
        <NoteEditor linkId={linkId} onDone={() => setComposing(false)} />
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-gray-500">
          {ar ? 'لا توجد ملاحظات بعد.' : 'Aucune note pour le moment.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => {
            const retracted = note.status === 'RETRACTED';
            return (
              <li
                key={note.id}
                className={
                  'rounded-lg border p-4 ' +
                  (retracted ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white')
                }
              >
                <div className="mb-2 flex items-center justify-between gap-3 text-xs text-gray-500">
                  <time dateTime={note.createdAt}>
                    {new Date(note.createdAt).toLocaleString(locale)}
                  </time>
                  <div className="flex items-center gap-3">
                    <RevisionHistory noteId={note.id} count={note.revisionCount} />
                    {!retracted && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingId(editingId === note.id ? null : note.id)}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          {ar ? 'تعديل' : 'Modifier'}
                        </button>
                        <RetractButton linkId={linkId} noteId={note.id} />
                      </>
                    )}
                  </div>
                </div>

                {editingId === note.id && !retracted ? (
                  <NoteEditor
                    linkId={linkId}
                    existing={{ id: note.id, content: note.content, updatedAt: note.updatedAt }}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <p
                    dir="auto"
                    className={
                      'whitespace-pre-wrap text-sm ' +
                      (retracted ? 'text-gray-400 line-through' : 'text-gray-800')
                    }
                  >
                    {note.content}
                  </p>
                )}

                {retracted && note.retractReason && (
                  <p className="mt-2 text-xs italic text-red-700">
                    {ar ? 'سُحبت: ' : 'Rétractée : '}
                    {note.retractReason}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showRetracted && (
        <p className="text-xs text-gray-400">
          {ar ? 'تُعرض الملاحظات المسحوبة.' : 'Notes rétractées affichées.'}
        </p>
      )}
    </div>
  );
}
