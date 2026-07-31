import { NoteStatus, RevisionReason, Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { encryptText, decryptText } from '@/lib/crypto/envelope';
import { requireLink, ResourceNotFoundError, type Actor } from '@/lib/rbac/guard';
import {
  shouldWriteRevision,
  validateNoteContent,
  validateRetractionReason,
} from './notes.validation';

export class NoteValidationError extends Error {
  constructor(public code: string) {
    super(`Invalid note: ${code}`);
    this.name = 'NoteValidationError';
  }
}

export interface NoteView {
  id: string;
  content: string;
  appointmentId: string | null;
  status: 'ACTIVE' | 'RETRACTED';
  retractReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  revisionCount: number;
}

export interface RevisionView {
  id: string;
  content: string;
  reason: 'CREATE' | 'EDIT' | 'RETRACT';
  createdAt: Date;
}

/**
 * Loads a note and proves this actor may act on it.
 *
 * Two gates, not one: requireLink answers "does your role grant this, and are
 * you on this link", then the author check enforces that a note is private to
 * its AUTHOR — not merely to the practice. Every failure is NotFound so an
 * out-of-scope caller cannot tell an existing note from a missing one (§5).
 */
async function loadOwnNote(actor: Actor, noteId: string, permission: 'note:read' | 'note:write') {
  const note = await prisma.consultationNote.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      linkId: true,
      authorUserId: true,
      status: true,
      lastRevisionAt: true,
      updatedAt: true,
    },
  });
  if (!note) throw new ResourceNotFoundError();

  const link = await requireLink(actor, note.linkId, permission);
  if (note.authorUserId !== actor.userId) throw new ResourceNotFoundError();

  return { note, link };
}

function toView(row: {
  id: string;
  contentEnc: Uint8Array;
  appointmentId: string | null;
  status: NoteStatus;
  retractReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { revisions: number };
}): NoteView {
  return {
    id: row.id,
    content: decryptText(row.contentEnc),
    appointmentId: row.appointmentId,
    status: row.status,
    retractReason: row.retractReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revisionCount: row._count?.revisions ?? 0,
  };
}

export async function createNote(
  actor: Actor,
  args: { linkId: string; appointmentId?: string; content: string },
): Promise<NoteView> {
  const invalid = validateNoteContent(args.content);
  if (invalid) throw new NoteValidationError(invalid);

  const link = await requireLink(actor, args.linkId, 'note:write');
  const now = new Date();
  const contentEnc = encryptText(args.content);

  return prisma.$transaction(async (tx) => {
    const note = await tx.consultationNote.create({
      data: {
        linkId: args.linkId,
        ...(args.appointmentId ? { appointmentId: args.appointmentId } : {}),
        contentEnc,
        authorUserId: actor.userId,
        lastRevisionAt: now,
      },
    });

    await tx.consultationNoteRevision.create({
      data: {
        noteId: note.id,
        contentEnc,
        authorUserId: actor.userId,
        reason: RevisionReason.CREATE,
      },
    });

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.DOCTOR,
      action: 'note.create',
      resourceType: 'ConsultationNote',
      resourceId: note.id,
      patientId: link.patientId,
    });

    return toView({ ...note, _count: { revisions: 1 } });
  });
}

export async function updateNote(
  actor: Actor,
  args: { noteId: string; content: string; explicit: boolean; expectedUpdatedAt?: Date },
): Promise<NoteView & { conflict: boolean }> {
  const invalid = validateNoteContent(args.content);
  if (invalid) throw new NoteValidationError(invalid);

  const { note, link } = await loadOwnNote(actor, args.noteId, 'note:write');

  // A retracted note is a closed record. Editing it would let a withdrawn
  // entry be quietly rewritten.
  if (note.status === NoteStatus.RETRACTED) throw new NoteValidationError('retracted');

  // Two tabs on one note: last write still wins on current text (both are the
  // same author, and both saves append revisions, so nothing is lost) — but the
  // caller is told, so the UI can warn rather than silently clobber.
  const conflict =
    args.expectedUpdatedAt !== undefined &&
    note.updatedAt.getTime() !== args.expectedUpdatedAt.getTime();

  const now = new Date();
  const contentEnc = encryptText(args.content);
  const writeRevision = shouldWriteRevision({
    explicit: args.explicit,
    lastRevisionAt: note.lastRevisionAt,
    now,
  });

  return prisma.$transaction(async (tx) => {
    // Insert the revision BEFORE the update that reads _count, so the returned
    // count includes it. (Doing it the other way round returns a count one
    // behind the row we just wrote.)
    if (writeRevision) {
      await tx.consultationNoteRevision.create({
        data: {
          noteId: note.id,
          contentEnc,
          authorUserId: actor.userId,
          reason: RevisionReason.EDIT,
        },
      });

      // Only deliberate checkpoints are audited; a debounced keystroke is not
      // an event worth a row.
      await audit(tx, {
        actorUserId: actor.userId,
        actorRole: Role.DOCTOR,
        action: 'note.update',
        resourceType: 'ConsultationNote',
        resourceId: note.id,
        patientId: link.patientId,
      });
    }

    const updated = await tx.consultationNote.update({
      where: { id: note.id },
      data: {
        contentEnc,
        ...(writeRevision ? { lastRevisionAt: now } : {}),
      },
      include: { _count: { select: { revisions: true } } },
    });

    return { ...toView(updated), conflict };
  });
}

export async function retractNote(
  actor: Actor,
  args: { noteId: string; reason: string },
): Promise<NoteView> {
  const invalid = validateRetractionReason(args.reason);
  if (invalid) throw new NoteValidationError(invalid);

  const { note, link } = await loadOwnNote(actor, args.noteId, 'note:write');
  if (note.status === NoteStatus.RETRACTED) throw new NoteValidationError('already_retracted');

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const current = await tx.consultationNote.findUniqueOrThrow({
      where: { id: note.id },
      select: { contentEnc: true },
    });

    // Snapshot the text as it stood at retraction, so the record shows exactly
    // what was withdrawn. Written before the count-bearing update so _count
    // reflects it.
    await tx.consultationNoteRevision.create({
      data: {
        noteId: note.id,
        contentEnc: current.contentEnc,
        authorUserId: actor.userId,
        reason: RevisionReason.RETRACT,
      },
    });

    const updated = await tx.consultationNote.update({
      where: { id: note.id },
      data: {
        status: NoteStatus.RETRACTED,
        retractedAt: now,
        retractedBy: actor.userId,
        retractReason: args.reason.trim(),
        lastRevisionAt: now,
      },
      include: { _count: { select: { revisions: true } } },
    });

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.DOCTOR,
      action: 'note.retract',
      resourceType: 'ConsultationNote',
      resourceId: note.id,
      patientId: link.patientId,
      metadata: { reason: args.reason.trim() },
    });

    return toView(updated);
  });
}

/**
 * The journal for one patient-doctor link.
 *
 * Audited once per view rather than once per note: a note can only ever be read
 * by its author, so per-note read rows would bury the audit log in "doctor read
 * own journal" noise, making it harder to search when it matters.
 */
export async function getJournal(
  actor: Actor,
  linkId: string,
  opts: { includeRetracted?: boolean } = {},
): Promise<NoteView[]> {
  const link = await requireLink(actor, linkId, 'note:read');

  const rows = await prisma.consultationNote.findMany({
    where: {
      linkId,
      authorUserId: actor.userId,
      ...(opts.includeRetracted ? {} : { status: NoteStatus.ACTIVE }),
    },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { revisions: true } } },
  });

  await audit(prisma, {
    actorUserId: actor.userId,
    actorRole: Role.DOCTOR,
    action: 'note.journal_read',
    resourceType: 'PatientDoctorLink',
    resourceId: linkId,
    patientId: link.patientId,
    metadata: { noteCount: rows.length },
  });

  return rows.map(toView);
}

export async function getRevisions(actor: Actor, noteId: string): Promise<RevisionView[]> {
  const { note } = await loadOwnNote(actor, noteId, 'note:read');

  const rows = await prisma.consultationNoteRevision.findMany({
    where: { noteId: note.id },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((r) => ({
    id: r.id,
    content: decryptText(r.contentEnc),
    reason: r.reason,
    createdAt: r.createdAt,
  }));
}
