'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import {
  createNote,
  updateNote,
  retractNote,
  getRevisions,
  NoteValidationError,
  type NoteView,
  type RevisionView,
} from '@/lib/clinical/notes';
import { NOTE_ERROR_MESSAGES } from '@/lib/clinical/notes.validation';

export type NoteActionState = {
  error?: string;
  ok?: boolean;
  note?: NoteView;
  conflict?: boolean;
};

function message(code: string, locale: string): string {
  const entry = (NOTE_ERROR_MESSAGES as Record<string, { fr: string; ar: string }>)[code];
  if (entry) return locale === 'ar' ? entry.ar : entry.fr;
  // Non-validation codes (retracted, already_retracted, ...) get a generic line.
  return locale === 'ar' ? 'تعذّر حفظ الملاحظة.' : "Impossible d'enregistrer la note.";
}

const createSchema = z.object({
  locale: z.string().default('fr'),
  linkId: z.string().min(1),
  appointmentId: z.string().optional(),
  content: z.string(),
});

export async function createNoteAction(
  _prev: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid input.' };
  const { locale, linkId, appointmentId, content } = parsed.data;

  try {
    const note = await createNote(actor, {
      linkId,
      ...(appointmentId ? { appointmentId } : {}),
      content,
    });
    revalidatePath(`/d/patients/${linkId}/notes`);
    return { ok: true, note };
  } catch (e) {
    if (e instanceof ResourceNotFoundError) return { error: 'Not found.' };
    if (e instanceof NoteValidationError) return { error: message(e.code, locale) };
    throw e;
  }
}

const updateSchema = z.object({
  locale: z.string().default('fr'),
  linkId: z.string().min(1),
  noteId: z.string().min(1),
  content: z.string(),
  explicit: z.enum(['true', 'false']),
  expectedUpdatedAt: z.string().optional(),
});

export async function updateNoteAction(
  _prev: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid input.' };
  const { locale, linkId, noteId, content, explicit, expectedUpdatedAt } = parsed.data;

  try {
    const result = await updateNote(actor, {
      noteId,
      content,
      explicit: explicit === 'true',
      ...(expectedUpdatedAt ? { expectedUpdatedAt: new Date(expectedUpdatedAt) } : {}),
    });
    // Only revalidate on a deliberate save; autosave shouldn't thrash the cache.
    if (explicit === 'true') revalidatePath(`/d/patients/${linkId}/notes`);
    return { ok: true, note: result, conflict: result.conflict };
  } catch (e) {
    if (e instanceof ResourceNotFoundError) return { error: 'Not found.' };
    if (e instanceof NoteValidationError) return { error: message(e.code, locale) };
    throw e;
  }
}

const retractSchema = z.object({
  locale: z.string().default('fr'),
  linkId: z.string().min(1),
  noteId: z.string().min(1),
  reason: z.string(),
});

export async function retractNoteAction(
  _prev: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = retractSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid input.' };
  const { locale, linkId, noteId, reason } = parsed.data;

  try {
    const note = await retractNote(actor, { noteId, reason });
    revalidatePath(`/d/patients/${linkId}/notes`);
    return { ok: true, note };
  } catch (e) {
    if (e instanceof ResourceNotFoundError) return { error: 'Not found.' };
    if (e instanceof NoteValidationError) return { error: message(e.code, locale) };
    throw e;
  }
}

/** Revision history for the dialog. Read path, so plaintext is resolved here on
 *  the server and only sent for a note the actor is authorised to read. */
export async function loadRevisionsAction(
  noteId: string,
): Promise<{ ok: true; revisions: RevisionView[] } | { ok: false }> {
  const actor = await getCurrentActor();
  if (!actor) return { ok: false };
  try {
    return { ok: true, revisions: await getRevisions(actor, noteId) };
  } catch {
    return { ok: false };
  }
}
