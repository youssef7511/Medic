/**
 * Validation and revision-coalescing rules for consultation notes.
 *
 * Pure and dependency-free: these decisions govern a legal medical record, and
 * they should be testable without a database or a clock.
 */

export const NOTE_MAX_CHARS = 20000;
export const RETRACTION_REASON_MIN_CHARS = 10;
export const RETRACTION_REASON_MAX_CHARS = 500;
export const REVISION_COALESCE_MINUTES = 5;
export const AUTOSAVE_DEBOUNCE_MS = 2000;

export type NoteContentError = 'empty' | 'too_long';
export type RetractionError = 'reason_too_short' | 'reason_too_long';

export function validateNoteContent(content: string): NoteContentError | null {
  if (content.trim().length === 0) return 'empty';
  if (content.length > NOTE_MAX_CHARS) return 'too_long';
  return null;
}

export function validateRetractionReason(reason: string): RetractionError | null {
  const trimmed = reason.trim();
  if (trimmed.length < RETRACTION_REASON_MIN_CHARS) return 'reason_too_short';
  if (trimmed.length > RETRACTION_REASON_MAX_CHARS) return 'reason_too_long';
  return null;
}

/**
 * Should this save append a revision row?
 *
 * A deliberate save is always a checkpoint. Autosave is coalesced so a long
 * editing session doesn't write hundreds of rows — but the window bounds how
 * far the immutable trail can lag behind current text.
 */
export function shouldWriteRevision(args: {
  explicit: boolean;
  lastRevisionAt: Date;
  now: Date;
}): boolean {
  if (args.explicit) return true;
  const elapsedMs = args.now.getTime() - args.lastRevisionAt.getTime();
  return elapsedMs >= REVISION_COALESCE_MINUTES * 60_000;
}

export const NOTE_ERROR_MESSAGES: Record<
  NoteContentError | RetractionError,
  { fr: string; ar: string }
> = {
  empty: { fr: 'La note est vide.', ar: 'الملاحظة فارغة.' },
  too_long: {
    fr: `La note dépasse ${NOTE_MAX_CHARS} caractères.`,
    ar: `تتجاوز الملاحظة ${NOTE_MAX_CHARS} حرفًا.`,
  },
  reason_too_short: {
    fr: `Indiquez un motif d'au moins ${RETRACTION_REASON_MIN_CHARS} caractères.`,
    ar: `أدخل سببًا لا يقل عن ${RETRACTION_REASON_MIN_CHARS} حرفًا.`,
  },
  reason_too_long: {
    fr: `Le motif dépasse ${RETRACTION_REASON_MAX_CHARS} caractères.`,
    ar: `يتجاوز السبب ${RETRACTION_REASON_MAX_CHARS} حرفًا.`,
  },
};
