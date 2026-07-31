# Consultation Notes — Design

**Date:** 2026-07-19
**Status:** Approved, ready for implementation planning
**Phase:** 4a (first of three sub-projects carved out of Phase 4)

---

## 1. Scope

A doctor records private clinical notes against a patient they treat, edits them
with a preserved history, and retracts mistaken entries.

**In scope:** encrypted note CRUD, revision history, retraction, the per-patient
journal view, and the doctor-side UI.

**Explicitly out of scope** — each gets its own spec:

| Deferred | Why separate |
|---|---|
| Documents & prescriptions (4b) | PDF engine, object storage, signed URLs, immutable issuance — a much larger surface |
| Patient-initiated sharing (4c) | Introduces the **first deliberate hole** in the §2 link boundary; deserves its own scrutiny |

Phase 4 in `architecture-plan.md` bundles all three into one 2.5-week phase.
Splitting them keeps the sharing security model from becoming an afterthought at
the end of a long phase.

---

## 2. Decisions

Each was chosen deliberately; the rejected option is recorded so the reasoning
survives.

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| 1 | **History is preserved and immutable.** Edits are unrestricted; every *deliberate* save writes an immutable revision row, and continuous autosave is coalesced (§3) so the trail never lags current text by more than 5 minutes. Nothing already written is ever overwritten in the revision table. | Silent overwrite; or lock-then-addenda | A note is evidence. Silent overwrite means a record could be rewritten after an adverse outcome with no trace. Lock-then-addenda is stronger still but adds a sealing workflow that is premature here. |
| 2 | **Single free-text body.** | SOAP four-field; templates | Matches how independent practitioners in this market write, and is fastest during a live consultation. Structured fields can be added *alongside* later without migrating existing notes. |
| 3 | **Per-patient journal**, entries optionally tagged to an appointment. | One-note-per-appointment; or no appointment link at all | Answers "what did I do last time?" — the question a doctor actually asks at the start of a consult. Still supports recording an unbooked walk-in or phone call. The existing schema already models this (`linkId` required, `appointmentId` nullable). |
| 4 | **No deletion.** A mistake is retracted: struck through, hidden from the journal, retained with its history and the reason. | Soft delete; hard delete | Preserving edit history is pointless if the whole note can vanish. A hidden-yet-retained note is the worst case: the doctor believes it is gone while it remains discoverable in a legal request. |
| 5 | **Storage: current row + append-only revision table.** | Revisions-only (current = latest); or immutable notes superseded by new notes | The journal is the hot path, hit at every consultation — it stays a single indexed query. Revisions are cold. The superseding model suits *documents*, which are issued to someone; a note is a private working record, and a typo fix should not create a new journal entry. |
| 6 | **Drafts autosave to the server, never `localStorage`.** | Browser-side draft cache | Stashing half-written clinical text in browser storage writes plaintext patient data to a clinic's shared computer, where it survives logout — exactly what sign-out was added to prevent (§10). |

---

## 3. Data model

Extends the existing `ConsultationNote`; adds one table and two enums.

```prisma
enum NoteStatus     { ACTIVE RETRACTED }
enum RevisionReason { CREATE EDIT RETRACT }

model ConsultationNote {
  id             String     @id @default(cuid())
  linkId         String                                  // the §2 boundary
  appointmentId  String?                                 // optional visit tag
  contentEnc     Bytes                                   // CURRENT text, encrypted
  authorUserId   String
  status         NoteStatus @default(ACTIVE)
  retractedAt    DateTime?  @db.Timestamptz(3)
  retractedBy    String?
  retractReason  String?
  lastRevisionAt DateTime   @db.Timestamptz(3)           // drives coalescing
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
  contentEnc   Bytes                                     // snapshot at save time
  authorUserId String
  reason       RevisionReason
  createdAt    DateTime @default(now()) @db.Timestamptz(3)

  note ConsultationNote @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId, createdAt])
}
```

All `DateTime` fields carry `@db.Timestamptz(3)` — Prisma's default
`timestamp without time zone` silently drops the offset (see the §6 note in
`architecture-plan.md`).

Each revision is encrypted independently. `encryptText` already mints a
per-record data key, so no change to the crypto layer.

### Limits

Named constants, not magic numbers, so the tests and the UI agree:

| Constant | Value | Reason |
|---|---|---|
| `NOTE_MAX_CHARS` | 20 000 | Generous for a consultation note; bounds the encrypted payload and the request body. |
| `RETRACTION_REASON_MIN_CHARS` | 10 | Long enough to exclude "x" or "oops" while not obstructing a genuine correction. |
| `RETRACTION_REASON_MAX_CHARS` | 500 | The reason is metadata, not a second note. |
| `REVISION_COALESCE_MINUTES` | 5 | See below. |
| `AUTOSAVE_DEBOUNCE_MS` | 2 000 | Balances losing work against write volume. |

### Revision coalescing

Autosave writing a revision per keystroke-pause would produce hundreds of rows
per note. Rules:

1. A revision is written on **create**, on **explicit save**, and on
   **retraction**.
2. During continuous autosave, a revision is written **at most once per 5
   minutes** (`REVISION_COALESCE_MINUTES`), gated on `lastRevisionAt`.
3. Autosave **always** updates `contentEnc`.

So current text is never lost, the trail never lags more than 5 minutes behind
it, and row count stays bounded.

---

## 4. Access control

No new mechanism — every path goes through the existing guard.

- Reads and writes call `requireLink(actor, linkId, 'note:read' | 'note:write')`,
  which answers both §5 questions: does the role grant this, and is this actor on
  this link.
- Mutations **additionally assert `authorUserId === actor.userId`**. A note is
  private to its *author*, not merely to the practice.
- `DOCTOR_STAFF` holds no `note:*` permission at all (see the matrix in
  `permissions.ts`), so the notes surface is unreachable for them.
- Out-of-scope access raises `ResourceNotFoundError` → **404, never 403** (§5).
- The existing RLS policy on `ConsultationNote` is extended to
  `ConsultationNoteRevision` in the same migration.

### Auditing — a deliberate divergence from §10

§10 requires *every document read* to be audited. Notes are treated differently:

- **Writes** (create, edit, retract) are always audited, with `patientId`.
- **Reads** are audited **once per journal view**, not once per note.

Rationale: a document can be shared and can leave the practice, so per-read
auditing is proportionate. A note can only ever be read by its author. Auditing
each one would write thousands of rows recording a doctor reading their own
journal — noise that makes the audit log *harder* to search at the moment it
actually matters.

---

## 5. Components

```
src/lib/clinical/notes.ts              domain ops, all guard-scoped
src/lib/clinical/notes.validation.ts   pure: limits, retraction reason, coalescing
src/app/[locale]/(doctor)/d/patients/[linkId]/notes/
  page.tsx            journal + editor (server)
  actions.ts          server actions
  NoteEditor.tsx      debounced autosave + explicit save
  NoteJournal.tsx     reverse-chronological; retracted entries struck through
  RevisionHistory.tsx dialog listing revisions
```

**Decryption is server-side only.** Ciphertext never reaches the browser;
plaintext is rendered into the page only for a note the actor is authorised to
read.

### Domain surface

```ts
createNote(actor, { linkId, appointmentId?, content })   → ConsultationNote
updateNote(actor, { noteId, content, explicit })         → ConsultationNote
retractNote(actor, { noteId, reason })                   → ConsultationNote
getJournal(actor, linkId, { includeRetracted? })         → NoteView[]
getRevisions(actor, noteId)                              → RevisionView[]
```

`explicit: true` forces a revision; `false` is autosave and defers to the
coalescing rule.

---

## 6. Failure modes

| Situation | Behaviour |
|---|---|
| `ENCRYPTION_MASTER_KEY` missing/invalid | Hard fail. Never a plaintext fallback. |
| Two tabs editing one note | Last write wins on current text; both write revisions, so no content is lost. An `updatedAt` mismatch surfaces a "changed elsewhere" warning. |
| Retraction reason too short | Rejected (< `RETRACTION_REASON_MIN_CHARS`). The reason is the only record of *why* a clinical entry was withdrawn. |
| Empty/whitespace content on create | Rejected — prevents blank notes cluttering the journal. |
| Content over `NOTE_MAX_CHARS` | Rejected before encryption, with the limit shown in the editor. |
| Note belongs to another doctor | `ResourceNotFoundError` → 404. |

---

## 7. Testing

**Pure unit tests** (no DB), in the existing `node:test` suite:

- Content validation: empty, whitespace-only, and over `NOTE_MAX_CHARS`.
- Retraction reason: shorter than `RETRACTION_REASON_MIN_CHARS` is rejected;
  whitespace does not count toward the minimum.
- Coalescing decision: given `lastRevisionAt` and `now`, should this save write a
  revision? Boundary cases at exactly 5 minutes.

**End-to-end against real Postgres** (extending `scripts/e2e-booking.ts`
patterns):

- create → edit → revision count grows → retract → journal hides it while
  history remains intact.
- Autosave inside the coalescing window does **not** add a revision, but *does*
  update current text.
- A second doctor requesting the note gets `ResourceNotFoundError`.
- Note content is stored as ciphertext — asserted by reading the raw column and
  confirming the plaintext does not appear.

**Browser check:** a `DOCTOR_STAFF` account sees no notes tab and gets a 404 on
the direct URL.

---

## 8. Follow-ups this design does not address

- **Documents & prescriptions (4b)** — including surfacing drug allergies on the
  prescribing screen (§3.1).
- **Patient-initiated sharing (4c)**.
- **Retention vs erasure** for notes when a link is archived or a doctor leaves
  the platform (§10 flags this; it is a policy decision, not a code one).
- **Search across notes** — deliberately omitted. Encrypted-at-rest content
  cannot be indexed by Postgres full-text without either leaking plaintext or
  building searchable encryption. Worth its own design if doctors ask for it.
