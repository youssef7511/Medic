# Consultation Notes Implementation Plan

> **STATUS: COMPLETE (2026-07-20).** All tasks implemented and verified — 10
> unit + 22 e2e checks green, production build clean, and the doctor
> write/edit/retract loop plus the §5 staff-block confirmed in a real browser
> (`scripts/verify-notes-ui.ts`). One deviation from plan: revision `_count` had
> to be read *after* inserting the revision row in the same transaction, not
> before, or the returned count lagged by one (caught by the e2e).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a doctor write private, encrypted clinical notes against a patient they treat, edit them with a preserved revision history, and retract mistaken entries.

**Architecture:** A `ConsultationNote` row holds the current encrypted text; every deliberate save also appends an immutable `ConsultationNoteRevision`. Continuous autosave is coalesced to at most one revision per 5 minutes so the trail never lags current text by more than that. All access runs through the existing `requireLink` guard — no new authorization mechanism.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Prisma 6 + PostgreSQL 16, `node:test` + `tsx` for tests, AES-256-GCM envelope encryption, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-19-consultation-notes-design.md`

## Global Constraints

- **Never log, return, or render clinical plaintext outside an authorized page.** Decryption is server-side only; ciphertext must never reach the browser.
- **Every clinical path goes through `requireLink(actor, linkId, permission)`.** No direct Prisma query on notes may bypass it.
- **Out-of-scope access raises `ResourceNotFoundError` → 404, never 403.** A 403 confirms the record exists.
- **All `DateTime` fields use `@db.Timestamptz(3)`.** Prisma's default `timestamp` silently drops the offset.
- **The revision table is append-only.** No application code may `update` or `delete` a `ConsultationNoteRevision`.
- **Logical CSS properties only** (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`). ESLint bans `ml-/mr-/pl-/pr-`; the app ships Arabic RTL.
- **All user-facing strings need `fr` and `ar`.**
- Run commands from the repo root. Prisma CLI does not read `.env.local` — prefix DB commands with `export $(grep -E '^(DATABASE_URL|ENCRYPTION_MASTER_KEY)' .env.local | tr -d '"')`.

### Limits (exact values — use these constants, never literals)

| Constant | Value |
|---|---|
| `NOTE_MAX_CHARS` | `20000` |
| `RETRACTION_REASON_MIN_CHARS` | `10` |
| `RETRACTION_REASON_MAX_CHARS` | `500` |
| `REVISION_COALESCE_MINUTES` | `5` |
| `AUTOSAVE_DEBOUNCE_MS` | `2000` |

### Existing interfaces this plan consumes

```ts
// src/lib/rbac/guard.ts
interface Actor { userId: string; roles: RoleAssignment[] }
class ResourceNotFoundError extends Error {}          // .name === 'ResourceNotFoundError'
function hasPermission(actor: Actor, permission: Permission): boolean
async function requireLink(actor: Actor, linkId: string, permission: Permission): Promise<PatientDoctorLink>

// src/lib/crypto/envelope.ts
function encryptText(plaintext: string): Uint8Array<ArrayBuffer>
function decryptText(blob: Buffer | Uint8Array): string

// src/lib/audit.ts
interface AuditEntry {
  actorUserId?: string | null; actorRole: string; action: string;
  resourceType: string; resourceId: string;
  patientId?: string | null; metadata?: Prisma.InputJsonValue;
}
async function audit(db: PrismaClient | Prisma.TransactionClient, entry: AuditEntry): Promise<void>

// src/lib/auth/session.ts
const getCurrentActor: () => Promise<Actor | null>

// src/lib/db.ts
const prisma: PrismaClient
```

Permissions `'note:read'`, `'note:write'` already exist in `src/lib/rbac/permissions.ts` and are granted to `DOCTOR` only.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | `NoteStatus`, `RevisionReason` enums; extend `ConsultationNote`; add `ConsultationNoteRevision` |
| `prisma/sql/002_notes_rls.sql` (create) | RLS policy for the revision table |
| `src/lib/clinical/notes.validation.ts` (create) | Pure: limits, content/reason validation, coalescing decision |
| `src/lib/clinical/notes.validation.test.ts` (create) | Unit tests for the above |
| `src/lib/clinical/notes.ts` (create) | Domain ops, all guard-scoped, all encryption/audit |
| `src/app/[locale]/(doctor)/d/patients/[linkId]/notes/page.tsx` (create) | Journal + editor route |
| `src/app/[locale]/(doctor)/d/patients/[linkId]/notes/actions.ts` (create) | Server actions |
| `src/app/[locale]/(doctor)/d/patients/[linkId]/notes/NoteEditor.tsx` (create) | Autosave + explicit save |
| `src/app/[locale]/(doctor)/d/patients/[linkId]/notes/NoteJournal.tsx` (create) | Reverse-chron list |
| `src/app/[locale]/(doctor)/d/patients/[linkId]/notes/RevisionHistory.tsx` (create) | Revision dialog |
| `src/app/[locale]/(doctor)/d/patients/[linkId]/page.tsx` (modify) | Link to the notes tab |
| `messages/fr.json`, `messages/ar.json` (modify) | Strings |
| `scripts/e2e-notes.ts` (create) | End-to-end against real Postgres |
| `package.json` (modify) | `e2e:notes` script |

---

## Task 1: Schema, migration, and RLS

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/sql/002_notes_rls.sql`

**Interfaces:**
- Consumes: existing `PatientDoctorLink` model.
- Produces: Prisma models `ConsultationNote` (fields `id, linkId, appointmentId, contentEnc, authorUserId, status, retractedAt, retractedBy, retractReason, lastRevisionAt, createdAt, updatedAt`) and `ConsultationNoteRevision` (fields `id, noteId, contentEnc, authorUserId, reason, createdAt`); enums `NoteStatus { ACTIVE RETRACTED }`, `RevisionReason { CREATE EDIT RETRACT }`.

- [ ] **Step 1: Add the two enums**

In `prisma/schema.prisma`, immediately after the existing `enum OutboxStatus { ... }` block, add:

```prisma
enum NoteStatus {
  ACTIVE
  RETRACTED
}

enum RevisionReason {
  CREATE
  EDIT
  RETRACT
}
```

- [ ] **Step 2: Replace the ConsultationNote model**

Find the existing `model ConsultationNote { ... }` block and replace it entirely with:

```prisma
/// Doctor's private clinical reasoning. Never crosses a practice boundary (§2).
model ConsultationNote {
  id             String     @id @default(cuid())
  linkId         String
  appointmentId  String?
  contentEnc     Bytes
  authorUserId   String
  status         NoteStatus @default(ACTIVE)
  retractedAt    DateTime?  @db.Timestamptz(3)
  retractedBy    String?
  retractReason  String?
  /// Drives revision coalescing — see notes.validation.ts.
  lastRevisionAt DateTime   @db.Timestamptz(3)
  createdAt      DateTime   @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime   @updatedAt @db.Timestamptz(3)

  link      PatientDoctorLink         @relation(fields: [linkId], references: [id], onDelete: Cascade)
  revisions ConsultationNoteRevision[]

  @@index([linkId, createdAt])
  @@index([appointmentId])
}

/// Append-only. No application code updates or deletes these rows — the same
/// rule that governs AuditLog.
model ConsultationNoteRevision {
  id           String         @id @default(cuid())
  noteId       String
  contentEnc   Bytes
  authorUserId String
  reason       RevisionReason
  createdAt    DateTime       @default(now()) @db.Timestamptz(3)

  note ConsultationNote @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId, createdAt])
}
```

- [ ] **Step 3: Generate the migration**

Run:
```bash
export $(grep -E '^DATABASE_URL' .env.local | tr -d '"')
npx prisma migrate dev --name consultation_notes
```
Expected: `Your database is now in sync with your schema.` and a new folder under `prisma/migrations/`.

- [ ] **Step 4: Write the RLS policy for the revision table**

Create `prisma/sql/002_notes_rls.sql`:

```sql
-- Row Level Security for note revisions (§3).
-- The app-layer guard is primary; this makes a missing WHERE clause unable to
-- leak another practice's clinical history. Mirrors the ConsultationNote policy
-- in 001_hardening.sql, one hop further out through the note.

ALTER TABLE "ConsultationNoteRevision" ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_revision_doctor_access ON "ConsultationNoteRevision"
  USING (
    "noteId" IN (
      SELECT n.id
      FROM "ConsultationNote" n
      JOIN "PatientDoctorLink" l ON l.id = n."linkId"
      WHERE l."doctorId" = current_doctor_id()
    )
  );
```

- [ ] **Step 5: Apply it**

Run:
```bash
docker exec -i medic-pg psql -U medic -d medic -v ON_ERROR_STOP=1 < prisma/sql/002_notes_rls.sql
```
Expected: `ALTER TABLE` then `CREATE POLICY`.

- [ ] **Step 6: Verify the schema landed**

Run:
```bash
docker exec medic-pg psql -U medic -d medic -tAc "select column_name, data_type from information_schema.columns where table_name='ConsultationNote' order by column_name;"
```
Expected: includes `lastRevisionAt | timestamp with time zone` and `status | USER-DEFINED`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/sql/002_notes_rls.sql
git commit -m "feat(notes): schema for consultation notes with revision history"
```

---

## Task 2: Validation and coalescing (pure logic)

**Files:**
- Create: `src/lib/clinical/notes.validation.ts`
- Create: `src/lib/clinical/notes.validation.test.ts`

**Interfaces:**
- Consumes: nothing (no imports from the app).
- Produces:
  ```ts
  const NOTE_MAX_CHARS: 20000
  const RETRACTION_REASON_MIN_CHARS: 10
  const RETRACTION_REASON_MAX_CHARS: 500
  const REVISION_COALESCE_MINUTES: 5
  const AUTOSAVE_DEBOUNCE_MS: 2000
  type NoteContentError = 'empty' | 'too_long'
  type RetractionError = 'reason_too_short' | 'reason_too_long'
  function validateNoteContent(content: string): NoteContentError | null
  function validateRetractionReason(reason: string): RetractionError | null
  function shouldWriteRevision(args: { explicit: boolean; lastRevisionAt: Date; now: Date }): boolean
  const NOTE_ERROR_MESSAGES: Record<NoteContentError | RetractionError, { fr: string; ar: string }>
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/clinical/notes.validation.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_MAX_CHARS,
  RETRACTION_REASON_MIN_CHARS,
  REVISION_COALESCE_MINUTES,
  validateNoteContent,
  validateRetractionReason,
  shouldWriteRevision,
} from './notes.validation';

test('accepts ordinary note content', () => {
  assert.equal(validateNoteContent('Patient reports chest pain since Tuesday.'), null);
});

test('rejects empty or whitespace-only content', () => {
  // A blank note would clutter the journal with an unusable record.
  assert.equal(validateNoteContent(''), 'empty');
  assert.equal(validateNoteContent('   \n\t '), 'empty');
});

test('rejects content over the limit', () => {
  assert.equal(validateNoteContent('x'.repeat(NOTE_MAX_CHARS)), null);
  assert.equal(validateNoteContent('x'.repeat(NOTE_MAX_CHARS + 1)), 'too_long');
});

test('retraction reason must be substantive', () => {
  // "oops" is not a record of why a clinical entry was withdrawn.
  assert.equal(validateRetractionReason('oops'), 'reason_too_short');
  assert.equal(validateRetractionReason('x'.repeat(RETRACTION_REASON_MIN_CHARS)), null);
});

test('whitespace does not count toward the retraction minimum', () => {
  assert.equal(validateRetractionReason('  a  '), 'reason_too_short');
});

test('retraction reason has an upper bound', () => {
  assert.equal(validateRetractionReason('x'.repeat(501)), 'reason_too_long');
});

test('an explicit save always writes a revision', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  assert.equal(
    shouldWriteRevision({ explicit: true, lastRevisionAt: now, now }),
    true,
    'a deliberate save is a checkpoint regardless of timing',
  );
});

test('autosave inside the coalescing window does not write a revision', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  const lastRevisionAt = new Date(now.getTime() - 60_000); // 1 minute ago
  assert.equal(shouldWriteRevision({ explicit: false, lastRevisionAt, now }), false);
});

test('autosave past the coalescing window writes a revision', () => {
  // Bounds how far the trail can lag behind current text.
  const now = new Date('2026-07-19T12:00:00Z');
  const lastRevisionAt = new Date(now.getTime() - (REVISION_COALESCE_MINUTES * 60_000 + 1000));
  assert.equal(shouldWriteRevision({ explicit: false, lastRevisionAt, now }), true);
});

test('autosave exactly at the window boundary writes a revision', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  const lastRevisionAt = new Date(now.getTime() - REVISION_COALESCE_MINUTES * 60_000);
  assert.equal(shouldWriteRevision({ explicit: false, lastRevisionAt, now }), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/clinical/notes.validation.test.ts`
Expected: FAIL — `Cannot find module './notes.validation'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/clinical/notes.validation.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/clinical/notes.validation.test.ts`
Expected: `pass 9`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clinical/notes.validation.ts src/lib/clinical/notes.validation.test.ts
git commit -m "feat(notes): validation and revision coalescing rules"
```

---

## Task 3: Domain layer

**Files:**
- Create: `src/lib/clinical/notes.ts`

**Interfaces:**
- Consumes: `requireLink`, `ResourceNotFoundError`, `Actor` from `@/lib/rbac/guard`; `encryptText`, `decryptText` from `@/lib/crypto/envelope`; `audit` from `@/lib/audit`; `prisma` from `@/lib/db`; everything from `./notes.validation`.
- Produces:
  ```ts
  class NoteValidationError extends Error { code: string }
  interface NoteView {
    id: string; content: string; appointmentId: string | null;
    status: 'ACTIVE' | 'RETRACTED'; retractReason: string | null;
    createdAt: Date; updatedAt: Date; revisionCount: number;
  }
  interface RevisionView {
    id: string; content: string; reason: 'CREATE' | 'EDIT' | 'RETRACT'; createdAt: Date;
  }
  async function createNote(actor, args: { linkId: string; appointmentId?: string; content: string }): Promise<NoteView>
  async function updateNote(actor, args: { noteId: string; content: string; explicit: boolean; expectedUpdatedAt?: Date }): Promise<NoteView & { conflict: boolean }>
  async function retractNote(actor, args: { noteId: string; reason: string }): Promise<NoteView>
  async function getJournal(actor, linkId: string, opts?: { includeRetracted?: boolean }): Promise<NoteView[]>
  async function getRevisions(actor, noteId: string): Promise<RevisionView[]>
  ```

- [ ] **Step 1: Write the implementation**

Create `src/lib/clinical/notes.ts`:

```ts
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

    return {
      ...toView({ ...note, _count: { revisions: 1 } }),
    };
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
    const updated = await tx.consultationNote.update({
      where: { id: note.id },
      data: {
        contentEnc,
        ...(writeRevision ? { lastRevisionAt: now } : {}),
      },
      include: { _count: { select: { revisions: true } } },
    });

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

    // Snapshot the text as it stood at retraction, so the record shows exactly
    // what was withdrawn.
    await tx.consultationNoteRevision.create({
      data: {
        noteId: note.id,
        contentEnc: current.contentEnc,
        authorUserId: actor.userId,
        reason: RevisionReason.RETRACT,
      },
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
 * Audited once per view rather than once per note (§4 of the spec): a note can
 * only ever be read by its author, so per-note read rows would bury the audit
 * log in "doctor read own journal" noise.
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add src/lib/clinical/notes.ts
git commit -m "feat(notes): guard-scoped domain layer with encryption and audit"
```

---

## Task 4: End-to-end verification against real Postgres

**Files:**
- Create: `scripts/e2e-notes.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: everything Task 3 produces.
- Produces: `npm run e2e:notes`, exiting 0 on success.

- [ ] **Step 1: Write the end-to-end script**

Create `scripts/e2e-notes.ts`:

```ts
/**
 * Consultation notes, end to end against a real Postgres.
 *
 * Covers what unit tests structurally cannot: encryption at rest, revision
 * accumulation, the retraction lifecycle, and cross-doctor isolation.
 *
 * Destructive — creates and removes its own fixtures. Never point at real data.
 */
import { PrismaClient, Role, ScopeType, Sex, LinkSource } from '@prisma/client';
import {
  createNote,
  updateNote,
  retractNote,
  getJournal,
  getRevisions,
  NoteValidationError,
} from '../src/lib/clinical/notes';
import { ResourceNotFoundError, type Actor } from '../src/lib/rbac/guard';

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✔' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

async function actorFor(userId: string): Promise<Actor> {
  const roles = await prisma.roleAssignment.findMany({ where: { userId } });
  return { userId, roles };
}

async function seed() {
  const specialty = await prisma.specialty.upsert({
    where: { slug: 'notes-e2e' },
    update: {},
    create: { slug: 'notes-e2e', name: { fr: 'Test', ar: 'اختبار' } },
  });

  const mkDoctor = async (tag: string) => {
    const user = await prisma.user.create({
      data: { email: `notes-${tag}-${Date.now()}@e2e.test`, locale: 'fr' },
    });
    await prisma.roleAssignment.create({
      data: { userId: user.id, role: Role.DOCTOR, scopeType: ScopeType.GLOBAL, grantedBy: 'e2e' },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: user.id,
        slug: `notes-${tag}-${Date.now()}`,
        specialtyId: specialty.id,
        licenseNumber: 'E2E',
        bio: { fr: '', ar: '' },
        headline: { fr: 'Dr E2E', ar: 'د' },
        languages: ['fr'],
        isPublished: true,
      },
    });
    return { user, profile };
  };

  const a = await mkDoctor('a');
  const b = await mkDoctor('b');

  const patientUser = await prisma.user.create({
    data: { email: `notes-p-${Date.now()}@e2e.test`, locale: 'fr' },
  });
  const patient = await prisma.patientProfile.create({
    data: {
      userId: patientUser.id,
      firstName: 'E2E',
      lastName: 'Patient',
      dateOfBirth: new Date('1990-01-01'),
      sex: Sex.UNSPECIFIED,
      phone: '+21600000000',
    },
  });

  const linkA = await prisma.patientDoctorLink.create({
    data: { patientId: patient.id, doctorId: a.profile.id, source: LinkSource.BOOKING },
  });
  const linkB = await prisma.patientDoctorLink.create({
    data: { patientId: patient.id, doctorId: b.profile.id, source: LinkSource.BOOKING },
  });

  return { a, b, patient, linkA, linkB };
}

async function main() {
  console.log('\n=== Consultation notes E2E ===\n');
  const fx = await seed();
  const doctorA = await actorFor(fx.a.user.id);
  const doctorB = await actorFor(fx.b.user.id);

  const SECRET = 'Suspected pneumonia, persistent cough three weeks.';

  console.log('create');
  const note = await createNote(doctorA, { linkId: fx.linkA.id, content: SECRET });
  check('note created', !!note.id);
  check('round-trips the text', note.content === SECRET);
  check('starts with one revision', note.revisionCount === 1, String(note.revisionCount));

  const raw = await prisma.consultationNote.findUniqueOrThrow({
    where: { id: note.id },
    select: { contentEnc: true },
  });
  check(
    'stored encrypted, not plaintext',
    !Buffer.from(raw.contentEnc).toString('utf8').includes('pneumonia'),
  );

  console.log('\nrevisions');
  const edited = await updateNote(doctorA, {
    noteId: note.id,
    content: `${SECRET} Started amoxicillin.`,
    explicit: true,
  });
  check('explicit save adds a revision', edited.revisionCount === 2, String(edited.revisionCount));

  const autosaved = await updateNote(doctorA, {
    noteId: note.id,
    content: `${SECRET} Started amoxicillin 500mg.`,
    explicit: false,
  });
  check(
    'autosave inside the window adds no revision',
    autosaved.revisionCount === 2,
    String(autosaved.revisionCount),
  );
  check('autosave still updates current text', autosaved.content.includes('500mg'));

  const stale = await updateNote(doctorA, {
    noteId: note.id,
    content: `${SECRET} Edited from a second tab.`,
    explicit: true,
    expectedUpdatedAt: new Date('2020-01-01T00:00:00Z'),
  });
  check('a stale edit is flagged as a conflict', stale.conflict === true);
  check('but the write still lands (nothing lost)', stale.content.includes('second tab'));

  const history = await getRevisions(doctorA, note.id);
  check('history is newest-first', history.length === 3 && history[0]!.reason === 'EDIT');
  check('original wording is recoverable', history.some((r) => r.content === SECRET));

  console.log('\nisolation (§2, §5)');
  let denied = false;
  try {
    await getRevisions(doctorB, note.id);
  } catch (e) {
    denied = e instanceof ResourceNotFoundError;
  }
  check("another doctor cannot read the note's history (404)", denied);

  const journalB = await getJournal(doctorB, fx.linkB.id);
  check('another doctor sees an empty journal', journalB.length === 0);

  let deniedJournal = false;
  try {
    await getJournal(doctorB, fx.linkA.id);
  } catch (e) {
    deniedJournal = e instanceof ResourceNotFoundError;
  }
  check("another doctor cannot open someone else's link journal", deniedJournal);

  console.log('\nretraction');
  let rejected = false;
  try {
    await retractNote(doctorA, { noteId: note.id, reason: 'oops' });
  } catch (e) {
    rejected = e instanceof NoteValidationError;
  }
  check('a trivial reason is rejected', rejected);

  const retracted = await retractNote(doctorA, {
    noteId: note.id,
    reason: 'Recorded against the wrong patient record.',
  });
  check('note retracted', retracted.status === 'RETRACTED');
  check('retraction snapshots a revision', retracted.revisionCount === 4);

  const visible = await getJournal(doctorA, fx.linkA.id);
  check('retracted note is hidden from the journal', visible.length === 0);

  const all = await getJournal(doctorA, fx.linkA.id, { includeRetracted: true });
  check('retracted note is still retrievable', all.length === 1);
  check('retraction reason is retained', !!all[0]!.retractReason);

  let editBlocked = false;
  try {
    await updateNote(doctorA, { noteId: note.id, content: 'rewritten', explicit: true });
  } catch (e) {
    editBlocked = e instanceof NoteValidationError;
  }
  check('a retracted note cannot be edited', editBlocked);

  console.log('\naudit (§10)');
  const actions = await prisma.auditLog.findMany({
    where: { resourceId: note.id },
    select: { action: true },
  });
  const names = actions.map((a) => a.action);
  check('write actions are audited', ['note.create', 'note.update', 'note.retract'].every((a) => names.includes(a)), names.join(','));

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('E2E crashed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, in the `"scripts"` block, immediately after the existing `"e2e"` line, add:

```json
    "e2e:notes": "tsx --env-file-if-exists=.env.local scripts/e2e-notes.ts",
```

- [ ] **Step 3: Run it**

Run:
```bash
docker start medic-pg
npm run e2e:notes
```
Expected: ends with `=== 22 passed, 0 failed ===` and exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-notes.ts package.json
git commit -m "test(notes): end-to-end coverage against real Postgres"
```

---

## Task 5: Server actions

**Files:**
- Create: `src/app/[locale]/(doctor)/d/patients/[linkId]/notes/actions.ts`

**Interfaces:**
- Consumes: `createNote`, `updateNote`, `retractNote`, `NoteValidationError` from `@/lib/clinical/notes`; `getCurrentActor` from `@/lib/auth/session`; `NOTE_ERROR_MESSAGES` from `@/lib/clinical/notes.validation`.
- Produces:
  ```ts
  type NoteActionState = { error?: string; ok?: boolean; noteId?: string }
  async function createNoteAction(prev: NoteActionState, formData: FormData): Promise<NoteActionState>
  async function saveNoteAction(prev: NoteActionState, formData: FormData): Promise<NoteActionState>
  async function retractNoteAction(prev: NoteActionState, formData: FormData): Promise<NoteActionState>
  async function autosaveNote(noteId: string, content: string): Promise<{ ok: boolean }>
  ```

- [ ] **Step 1: Write the implementation**

Create the file:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { createNote, updateNote, retractNote, NoteValidationError } from '@/lib/clinical/notes';
import {
  NOTE_ERROR_MESSAGES,
  type NoteContentError,
  type RetractionError,
} from '@/lib/clinical/notes.validation';

export type NoteActionState = { error?: string; ok?: boolean; noteId?: string };

function messageFor(code: string, locale: string): string {
  const entry = NOTE_ERROR_MESSAGES[code as NoteContentError | RetractionError];
  if (!entry) {
    return locale === 'ar' ? 'تعذّر حفظ الملاحظة.' : "La note n'a pas pu être enregistrée.";
  }
  return locale === 'ar' ? entry.ar : entry.fr;
}

/** Maps domain errors to user-facing text. Out-of-scope stays indistinguishable
 *  from missing (§5). */
function toState(e: unknown, locale: string): NoteActionState {
  if (e instanceof NoteValidationError) return { error: messageFor(e.code, locale) };
  if (e instanceof ResourceNotFoundError) {
    return { error: locale === 'ar' ? 'الملاحظة غير موجودة.' : 'Note introuvable.' };
  }
  throw e;
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
  if (!parsed.success) return { error: 'Invalid request.' };
  const { locale, linkId, appointmentId, content } = parsed.data;

  try {
    const note = await createNote(actor, {
      linkId,
      ...(appointmentId ? { appointmentId } : {}),
      content,
    });
    revalidatePath(`/d/patients/${linkId}/notes`);
    return { ok: true, noteId: note.id };
  } catch (e) {
    return toState(e, locale);
  }
}

const saveSchema = z.object({
  locale: z.string().default('fr'),
  linkId: z.string().min(1),
  noteId: z.string().min(1),
  content: z.string(),
});

export async function saveNoteAction(
  _prev: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request.' };
  const { locale, linkId, noteId, content } = parsed.data;

  try {
    await updateNote(actor, { noteId, content, explicit: true });
    revalidatePath(`/d/patients/${linkId}/notes`);
    return { ok: true, noteId };
  } catch (e) {
    return toState(e, locale);
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
  if (!parsed.success) return { error: 'Invalid request.' };
  const { locale, linkId, noteId, reason } = parsed.data;

  try {
    await retractNote(actor, { noteId, reason });
    revalidatePath(`/d/patients/${linkId}/notes`);
    return { ok: true, noteId };
  } catch (e) {
    return toState(e, locale);
  }
}

/**
 * Autosave. Not a form action — called directly from the editor on a debounce,
 * so it neither revalidates nor writes a revision (the domain layer coalesces).
 * Failures are swallowed to a flag: an autosave hiccup must not interrupt a
 * doctor mid-consultation, and the explicit Save button remains the checkpoint.
 */
export async function autosaveNote(noteId: string, content: string): Promise<{ ok: boolean }> {
  const actor = await getCurrentActor();
  if (!actor) return { ok: false };

  try {
    await updateNote(actor, { noteId, content, explicit: false });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(doctor)/d/patients/[linkId]/notes/actions.ts"
git commit -m "feat(notes): server actions"
```

---

## Task 6: Journal and editor UI

**Files:**
- Create: `src/app/[locale]/(doctor)/d/patients/[linkId]/notes/NoteEditor.tsx`
- Create: `src/app/[locale]/(doctor)/d/patients/[linkId]/notes/NoteJournal.tsx`
- Create: `src/app/[locale]/(doctor)/d/patients/[linkId]/notes/RevisionHistory.tsx`
- Create: `src/app/[locale]/(doctor)/d/patients/[linkId]/notes/page.tsx`
- Modify: `src/app/[locale]/(doctor)/d/patients/[linkId]/page.tsx`

**Interfaces:**
- Consumes: the four actions from Task 5; `getJournal`, `getRevisions`, `NoteView`, `RevisionView` from `@/lib/clinical/notes`; `AUTOSAVE_DEBOUNCE_MS`, `NOTE_MAX_CHARS` from `@/lib/clinical/notes.validation`; `Button` from `@/components/ui/button`; `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogTrigger` from `@/components/ui/dialog`.
- Produces: the route `/[locale]/d/patients/[linkId]/notes`.

- [ ] **Step 1: Write the editor**

Create `NoteEditor.tsx`:

```tsx
'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AUTOSAVE_DEBOUNCE_MS, NOTE_MAX_CHARS } from '@/lib/clinical/notes.validation';
import { createNoteAction, saveNoteAction, autosaveNote, type NoteActionState } from './actions';

const initial: NoteActionState = {};

export function NoteEditor({
  linkId,
  noteId,
  initialContent = '',
}: {
  linkId: string;
  noteId?: string;
  initialContent?: string;
}) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const isNew = !noteId;

  const [state, formAction, pending] = useActionState(
    isNew ? createNoteAction : saveNoteAction,
    initial,
  );
  const [content, setContent] = useState(initialContent);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autosave only makes sense once the note exists — a new note has no id to
  // save against, so it waits for the first explicit save.
  useEffect(() => {
    if (isNew || content === initialContent) return;
    if (timer.current) clearTimeout(timer.current);

    timer.current = setTimeout(async () => {
      setAutosaveState('saving');
      const res = await autosaveNote(noteId!, content);
      setAutosaveState(res.ok ? 'saved' : 'idle');
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [content, noteId, isNew, initialContent]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="linkId" value={linkId} />
      {noteId && <input type="hidden" name="noteId" value={noteId} />}

      <textarea
        name="content"
        rows={10}
        maxLength={NOTE_MAX_CHARS}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={ar ? 'ملاحظات الاستشارة…' : 'Notes de consultation…'}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm leading-relaxed"
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {autosaveState === 'saving' && (ar ? 'جارٍ الحفظ…' : 'Enregistrement…')}
          {autosaveState === 'saved' && (ar ? 'تم الحفظ تلقائيًا' : 'Enregistré automatiquement')}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-gray-400">
            {content.length} / {NOTE_MAX_CHARS}
          </span>
          <Button type="submit" size="sm" disabled={pending || content.trim().length === 0}>
            {ar ? 'حفظ' : 'Enregistrer'}
          </Button>
        </div>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Write the revision dialog**

Create `RevisionHistory.tsx`:

```tsx
'use client';

import { useLocale } from 'next-intl';
import { History } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface RevisionItem {
  id: string;
  content: string;
  reason: 'CREATE' | 'EDIT' | 'RETRACT';
  label: string;
}

const REASON_TEXT: Record<string, { fr: string; ar: string }> = {
  CREATE: { fr: 'Création', ar: 'إنشاء' },
  EDIT: { fr: 'Modification', ar: 'تعديل' },
  RETRACT: { fr: 'Rétractation', ar: 'سحب' },
};

export function RevisionHistory({ revisions }: { revisions: RevisionItem[] }) {
  const locale = useLocale();
  const ar = locale === 'ar';

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <History className="h-4 w-4" />
          {ar ? `السجل (${revisions.length})` : `Historique (${revisions.length})`}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ar ? 'سجل التعديلات' : 'Historique des modifications'}</DialogTitle>
        </DialogHeader>
        <ol className="space-y-4">
          {revisions.map((r) => (
            <li key={r.id} className="border-s-2 border-gray-200 ps-3">
              <p className="text-xs text-gray-500">
                {r.label} · {ar ? REASON_TEXT[r.reason]?.ar : REASON_TEXT[r.reason]?.fr}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{r.content}</p>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Write the journal**

Create `NoteJournal.tsx`:

```tsx
'use client';

import { useActionState, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { RevisionHistory, type RevisionItem } from './RevisionHistory';
import { NoteEditor } from './NoteEditor';
import { retractNoteAction, type NoteActionState } from './actions';

export interface JournalItem {
  id: string;
  content: string;
  status: 'ACTIVE' | 'RETRACTED';
  retractReason: string | null;
  label: string;
  revisionCount: number;
  revisions: RevisionItem[];
}

const initial: NoteActionState = {};

export function NoteJournal({ linkId, items }: { linkId: string; items: JournalItem[] }) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [editing, setEditing] = useState<string | null>(null);
  const [retracting, setRetracting] = useState<string | null>(null);
  const [state, retractAction, pending] = useActionState(retractNoteAction, initial);

  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        {ar ? 'لا توجد ملاحظات بعد.' : 'Aucune note pour le moment.'}
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {items.map((n) => (
        <li
          key={n.id}
          className={
            'rounded-lg border p-4 ' +
            (n.status === 'RETRACTED' ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white')
          }
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-gray-500">{n.label}</p>
            <div className="flex items-center gap-1">
              {n.revisions.length > 0 && <RevisionHistory revisions={n.revisions} />}
              {n.status === 'ACTIVE' && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(n.id)}>
                    {ar ? 'تعديل' : 'Modifier'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRetracting(n.id)}>
                    {ar ? 'سحب' : 'Rétracter'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {editing === n.id ? (
            <div className="mt-3">
              <NoteEditor linkId={linkId} noteId={n.id} initialContent={n.content} />
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)} className="mt-2">
                {ar ? 'إغلاق' : 'Fermer'}
              </Button>
            </div>
          ) : (
            <p
              className={
                'mt-2 whitespace-pre-wrap text-sm ' +
                (n.status === 'RETRACTED' ? 'text-gray-400 line-through' : 'text-gray-800')
              }
            >
              {n.content}
            </p>
          )}

          {n.status === 'RETRACTED' && n.retractReason && (
            <p className="mt-2 text-xs text-gray-500">
              {ar ? 'سبب السحب: ' : 'Motif de rétractation : '}
              {n.retractReason}
            </p>
          )}

          {retracting === n.id && (
            <form action={retractAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="linkId" value={linkId} />
              <input type="hidden" name="noteId" value={n.id} />
              <input
                name="reason"
                required
                placeholder={ar ? 'سبب السحب' : 'Motif de la rétractation'}
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <Button type="submit" variant="destructive" size="sm" disabled={pending}>
                {ar ? 'تأكيد' : 'Confirmer'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRetracting(null)}>
                {ar ? 'إلغاء' : 'Annuler'}
              </Button>
            </form>
          )}

          {state.error && retracting === n.id && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {state.error}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Write the page**

Create `page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { getJournal, getRevisions } from '@/lib/clinical/notes';
import { localeNumberingSystem, type Locale } from '@/i18n/config';
import { NoteEditor } from './NoteEditor';
import { NoteJournal, type JournalItem } from './NoteJournal';

export const dynamic = 'force-dynamic';

export default async function NotesPage({
  params,
}: {
  params: Promise<{ linkId: string; locale: string }>;
}) {
  const { linkId, locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const numbering = localeNumberingSystem[locale as Locale] ?? 'latn';
  const intlLocale = `${locale}-u-nu-${numbering}`;
  const fmt = (d: Date) =>
    DateTime.fromJSDate(d)
      .setLocale(intlLocale)
      .toLocaleString({ day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  let notes;
  try {
    notes = await getJournal(actor, linkId, { includeRetracted: true });
  } catch (e) {
    // Out of scope is indistinguishable from missing (§5).
    if (e instanceof ResourceNotFoundError) notFound();
    throw e;
  }

  const items: JournalItem[] = await Promise.all(
    notes.map(async (n) => ({
      id: n.id,
      content: n.content,
      status: n.status,
      retractReason: n.retractReason,
      label: fmt(n.createdAt),
      revisionCount: n.revisionCount,
      revisions: (await getRevisions(actor, n.id)).map((r) => ({
        id: r.id,
        content: r.content,
        reason: r.reason,
        label: fmt(r.createdAt),
      })),
    })),
  );

  return (
    <section>
      <h1 className="text-2xl font-bold">{ar ? 'ملاحظات الاستشارة' : 'Notes de consultation'}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {ar
          ? 'خاصة بك وحدك. لا يراها المريض ولا الطاقم الإداري.'
          : 'Privées : ni le patient ni le personnel administratif n’y ont accès.'}
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-medium">{ar ? 'ملاحظة جديدة' : 'Nouvelle note'}</h2>
        <NoteEditor linkId={linkId} />
      </div>

      <div className="mt-8">
        <NoteJournal linkId={linkId} items={items} />
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Link the tab from the patient page**

In `src/app/[locale]/(doctor)/d/patients/[linkId]/page.tsx`, replace the closing paragraph

```tsx
      <p className="mt-4 text-gray-500">
        Appointments, notes, documents, and messages for this link render here —
        all already authorized by requireLink above.
      </p>
```

with:

```tsx
      <Link
        href={`/d/patients/${linkId}/notes`}
        className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline"
      >
        Notes de consultation →
      </Link>
```

and add this import at the top of the same file:

```tsx
import { Link } from '@/i18n/navigation';
```

- [ ] **Step 6: Typecheck, lint, build**

Run:
```bash
npx tsc --noEmit && npx next lint && npm run build
```
Expected: no type errors, `✔ No ESLint warnings or errors`, build exits 0.

- [ ] **Step 7: Commit**

```bash
git add "src/app/[locale]/(doctor)/d/patients/[linkId]"
git commit -m "feat(notes): journal, editor, and revision history UI"
```

---

## Task 7: Browser verification

**Files:**
- Create: `scripts/verify-notes.ts`

**Interfaces:**
- Consumes: the running dev server and the fixtures from `.claude/skills/run-medic/fixtures.ts`.
- Produces: `NOTES OK` on success.

- [ ] **Step 1: Write the browser check**

Create `scripts/verify-notes.ts`:

```ts
/**
 * Drives the notes UI in a real browser as a doctor.
 *
 * Verifies what neither unit nor domain tests can: that the page renders, an
 * edit round-trips through the form, and — critically — that clinical plaintext
 * is never shipped to the browser as ciphertext or leaked into the console.
 */
import { chromium } from 'playwright';
import { authenticator } from 'otplib';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.DOCTOR_EMAIL ?? 'doctor.ui@medic.test';
const PASSWORD = process.env.DOCTOR_PASSWORD ?? 'correct-horse-battery-staple';
const SECRET = process.env.MFA_SECRET;
const LINK_ID = process.env.LINK_ID;

let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✔' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

async function main() {
  if (!SECRET) throw new Error('MFA_SECRET is required.');
  if (!LINK_ID) throw new Error('LINK_ID is required (a link belonging to the fixture doctor).');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleText: string[] = [];
  page.on('console', (m) => consoleText.push(m.text()));

  await page.goto(`${BASE}/fr/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('#totp', { timeout: 15000 });
  await page.fill('#totp', authenticator.generate(SECRET));
  await page.click('button[type=submit]');
  await page.waitForURL(/\/fr\/d\b/, { timeout: 20000 });

  await page.goto(`${BASE}/fr/d/patients/${LINK_ID}/notes`, { waitUntil: 'networkidle' });
  check('notes page loads', page.url().includes('/notes'));

  const marker = `E2E marker ${Date.now()}`;
  await page.fill('textarea[name=content]', `Consultation note. ${marker}`);
  await page.click('button[type=submit]');
  await page.waitForTimeout(1500);

  const body = await page.locator('body').innerText();
  check('saved note appears in the journal', body.includes(marker));

  check(
    'no clinical text leaked to the console',
    !consoleText.some((t) => t.includes(marker)),
  );

  await page.screenshot({ path: '.playwright-cli/notes-fr.png', fullPage: true });

  await page.goto(`${BASE}/ar/d/patients/${LINK_ID}/notes`, { waitUntil: 'networkidle' });
  check('arabic page is RTL', (await page.getAttribute('html', 'dir')) === 'rtl');
  await page.screenshot({ path: '.playwright-cli/notes-ar.png', fullPage: true });

  await browser.close();
  console.log(failed === 0 ? '\nNOTES OK\n' : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Get a link id for the fixture doctor**

Run:
```bash
export $(grep -E '^DATABASE_URL' .env.local | tr -d '"')
docker exec medic-pg psql -U medic -d medic -tAc "select l.id from \"PatientDoctorLink\" l join \"DoctorProfile\" d on d.id=l.\"doctorId\" join \"User\" u on u.id=d.\"userId\" where u.email='doctor.ui@medic.test' limit 1;"
```
Expected: one cuid. If empty, run `npx tsx scripts/demo-week.ts` first.

- [ ] **Step 3: Run the browser check**

Run (substituting the values):
```bash
npm run dev &
sleep 12
MFA_SECRET=$(docker exec medic-pg psql -U medic -d medic -tAc "select \"mfaSecret\" from \"User\" where email='doctor.ui@medic.test';" | tr -d ' \r') \
LINK_ID=<link id from step 2> \
npx tsx scripts/verify-notes.ts
```
Expected: ends with `NOTES OK`.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-notes.ts
git commit -m "test(notes): browser verification incl. plaintext-leak check"
```

---

## Task 8: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture-plan.md`

- [ ] **Step 1: Update the README status list**

In `README.md`, in the "Built, tested, and building clean" list, add after the availability-editor bullet:

```markdown
- **Consultation notes** (Phase 4a) — encrypted, doctor-private notes with an
  append-only revision history and retraction (no deletion). Autosave is
  coalesced to at most one revision per 5 minutes.
```

- [ ] **Step 2: Update the plan's progress note**

In `docs/architecture-plan.md`, replace the `> **Progress (2026-07-19):**` paragraph's final sentence (`Next: Phase 4, clinical notes and documents.`) with:

```markdown
> Phase 4a (consultation notes) complete — see
> `docs/superpowers/specs/2026-07-19-consultation-notes-design.md`. Next: 4b
> documents and prescriptions, then 4c patient-initiated sharing.
```

- [ ] **Step 3: Run the whole suite**

Run:
```bash
npm test && npx tsc --noEmit && npx next lint && npm run e2e:notes
```
Expected: `pass 96` (87 existing + 9 new), no type errors, no lint warnings, `20 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture-plan.md
git commit -m "docs(notes): record Phase 4a completion"
```
