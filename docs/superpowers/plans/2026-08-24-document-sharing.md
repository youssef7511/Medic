# Patient-Initiated Document Sharing — Implementation Plan

**Status:** Ready for execution
**Date:** 2026-08-24
**Phase:** 4c (third of three sub-projects carved out of Phase 4)

**Spec:** `docs/superpowers/specs/2026-08-24-document-sharing-design.md`

**Goal:** A patient shares one immutable document (prescription) with another
doctor. The doctor can read it. The patient can revoke the share. Every action
is audited. This is the first deliberate hole in the §2 link boundary.

**Architecture:** A `DocumentShare` grant table (per document, per target
doctor). The existing `getDocumentForDownload` and `listDocuments` gain a
share-check branch. RLS policies grow a third `OR` clause. The patient gets a
Share button on their timeline; the doctor gets a "shared with me" page.

> **For agentic workers:** implement task-by-task; each task ends at a green
> verification gate before the next begins.

---

## Global Constraints

- Host-agnostic (§10): no Vercel-specific primitives.
- Guard: `requireLink(actor, linkId, permission)` and `requireLinkAny(actor,
  linkId, permission[])` throw `ResourceNotFoundError` (→ 404, never 403).
  The new `requireLinkOrShare` follows the same discipline.
- Timestamps: every Prisma `DateTime` carries `@db.Timestamptz(3)`.
- Tests: `node:test` via `tsx`; e2e scripts load `.env.local` through
  `tsx --env-file-if-exists`.
- All existing document e2e assertions about cross-doctor isolation (404 on
  download) remain true for doctors without a share; new assertions cover the
  share-mediated path.

---

## Task 1 — Schema migration

**Files:** `prisma/schema.prisma`, new migration SQL, `prisma/migrations/`.

### Schema changes

1. Add `ShareStatus` enum: `ACTIVE`, `REVOKED`.
2. Add `DocumentShare` model per spec §3.
3. Add `shares DocumentShare[]` relation on `Document`.

### Migration SQL

```sql
-- Patient-initiated document sharing (Phase 4c).
-- Spec: docs/superpowers/specs/2026-08-24-document-sharing-design.md

CREATE TYPE "ShareStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "DocumentShare" (
    "id"             TEXT           NOT NULL,
    "documentId"     TEXT           NOT NULL,
    "doctorId"       TEXT           NOT NULL,
    "sharedByUserId" TEXT           NOT NULL,
    "status"         "ShareStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"      TIMESTAMPTZ(3),

    CONSTRAINT "DocumentShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentShare_documentId_doctorId_key"
  ON "DocumentShare"("documentId", "doctorId");
CREATE INDEX "DocumentShare_doctorId_status_idx"
  ON "DocumentShare"("doctorId", "status");

ALTER TABLE "DocumentShare"
  ADD CONSTRAINT "DocumentShare_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentShare"
  ADD CONSTRAINT "DocumentShare_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: extend document_access with share branch.
ALTER POLICY document_access ON "Document"
  USING (
    "linkId" IN (
      SELECT id FROM "PatientDoctorLink"
      WHERE "doctorId" = current_doctor_id()
         OR "patientId" = current_patient_id()
    )
    OR "id" IN (
      SELECT "documentId" FROM "DocumentShare"
      WHERE "doctorId" = current_doctor_id()
        AND "status" = 'ACTIVE'
    )
  );

-- RLS: extend prescription_access with share branch (hop through Document).
ALTER POLICY prescription_access ON "Prescription"
  USING (
    "documentId" IN (
      SELECT d.id
      FROM "Document" d
      JOIN "PatientDoctorLink" l ON l.id = d."linkId"
      WHERE l."doctorId" = current_doctor_id()
         OR l."patientId" = current_patient_id()
    )
    OR "documentId" IN (
      SELECT ds."documentId" FROM "DocumentShare" ds
      WHERE ds."doctorId" = current_doctor_id()
        AND ds."status" = 'ACTIVE'
    )
  );

ALTER TABLE "DocumentShare" ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_share_doctor_access ON "DocumentShare"
  USING (
    "doctorId" = current_doctor_id()
    OR "documentId" IN (
      SELECT d.id FROM "Document" d
      JOIN "PatientDoctorLink" l ON l.id = d."linkId"
      WHERE l."patientId" = current_patient_id()
    )
  );
```

### Verification gate

- `npx prisma generate` succeeds.
- `npx prisma db push` or `migrate dev` applies without reset.
- A node one-liner confirms `prisma.documentShare` exists.
- `tsc --noEmit` clean.

---

## Task 2 — Guard extension

**Files:** `src/lib/rbac/guard.ts`, `src/lib/rbac/guard.test.ts` (new).

### `requireLinkOrShare` helper

```ts
/**
 * Succeeds if the actor passes requireLinkAny on the document's link,
 * OR is a DOCTOR with an ACTIVE DocumentShare on this document.
 *
 * The first path is the fast path (same-link, no extra query). The share
 * path fires only when the link check fails — a cold read for shared docs.
 *
 * Both paths preserve the 404-not-403 discipline (§5).
 */
export async function requireLinkOrShare(
  actor: Actor,
  documentId: string,
  permissions: Permission[],
): Promise<{ patientId: string; via: 'link' | 'share'; shareId?: string }>
```

Implementation:
1. Load document by id (select `linkId` + `link.patientId`).
2. Try `requireLinkAny(actor, doc.linkId, permissions)`. If success → return
   `{ patientId: doc.link.patientId, via: 'link' }`.
3. If `ResourceNotFoundError` → check: does the actor have an active role
   granting `'document:read'`? If not → throw `ResourceNotFoundError`.
4. Query `DocumentShare` where `documentId = doc.id AND doctorId = doctorProfileId AND status = 'ACTIVE'`.
5. If share found → return `{ patientId: doc.link.patientId, via: 'share', shareId: share.id }`.
6. If not found → throw `ResourceNotFoundError`.

The `doctorProfileId` is resolved from the actor's `DOCTOR` role assignment
(scopeId when `scopeType === DOCTOR`). This avoids an extra DB query — the
role row already carries the doctor profile id.

### Test file

Unit tests for the pure branching logic:
- Same-link doctor → `via: 'link'`
- Shared doctor (no link) → `via: 'share'`
- No link, no share → `ResourceNotFoundError`
- REVOKED share → `ResourceNotFoundError`
- Patient on the link → `via: 'link'` (patient's own doc)

### Verification gate

- `npx tsx --test src/lib/rbac/guard.test.ts` green.
- `tsc --noEmit` clean.

---

## Task 3 — Domain layer

**Files:** `src/lib/documents/sharing.ts` (new), `src/lib/documents/prescriptions.ts` (modified).

### `sharing.ts` — new file

```ts
export interface ShareView {
  id: string;
  documentId: string;
  doctorName: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: Date;
  revokedAt: Date | null;
}

export interface SharedDocumentView extends DocumentView {
  sharedByPatientName: string;
  sharedAt: Date;
}

export async function shareDocument(
  actor: Actor,
  args: { documentId: string; targetDoctorId: string },
): Promise<ShareView>

export async function revokeShare(
  actor: Actor,
  args: { shareId: string },
): Promise<ShareView>

export async function listSharedDocuments(
  actor: Actor,
  locale?: string,
): Promise<SharedDocumentView[]>
```

### `shareDocument` flow

1. Load document via `loadOwnedDocument(actor, documentId, 'document:share')`
   (same pattern as `loadOwnedDocument` in prescriptions.ts — find + requireLink).
   This proves the actor is the patient on the document's link.
2. Validate: document must be `ACTIVE` (`DocumentValidationError('not_active')`
   if SUPERSEDED/REVOKED).
3. Load target doctor: `prisma.doctorProfile.findUniqueOrThrow({ where: { id: targetDoctorId }, select: { id: true, firstName, lastName, headline } })`.
   Must exist and `isPublished === true` (`DocumentValidationError('doctor_not_found')`).
4. `prisma.$transaction`: upsert `DocumentShare` on the `@@unique` constraint
   + audit `document.share` with metadata `{ targetDoctorId, documentType: doc.type }`.
5. Return `ShareView`.

### `revokeShare` flow

1. Load share by id. If not found → `ResourceNotFoundError`.
2. Load the document on the share → `requireLink(actor, doc.linkId, 'document:share')`.
   This proves the actor is the patient who owns the document.
3. Validate: share must be `ACTIVE` (`DocumentValidationError('share_already_revoked')`).
4. `prisma.$transaction`: update share `status = REVOKED, revokedAt = now` +
   audit `document.share.revoke`.
5. Return `ShareView`.

### `listSharedDocuments` flow

1. Resolve doctor profile from actor: `prisma.doctorProfile.findUnique({ where: { userId: actor.userId } })`.
   If not found → throw (shouldn't happen on a doctor-space page).
2. Query: find all `DocumentShare` where `doctorId = profile.id AND status = 'ACTIVE'`,
   join `Document` (type, status, version, issuedAt, revokeReason) and
   `PatientDoctorLink → PatientProfile` (firstName, lastName).
3. For each document, compute `medicationSummary` by decrypting the prescription
   (same pattern as `listDocuments` — decrypt medicationsEnc, take first drug + count).
4. Audit `document.share_list` once per view.
5. Return `SharedDocumentView[]`.

### Modifications to `prescriptions.ts`

`getDocumentForDownload` gains a share branch:

```ts
// Current: requireLinkAny(actor, doc.linkId, ['document:read:own', 'document:read'])
// New:
const linkResult = await requireLinkOrShare(actor, doc.id, ['document:read:own', 'document:read']);
// linkResult.via tells us the authorization path; audit metadata includes it.
```

The audit entry adds `metadata: { via: linkResult.via, shareId: linkResult.shareId }`.

`listDocuments` is NOT modified — it stays scoped to a single link. Shared
documents are fetched by the separate `listSharedDocuments` function.

### Verification gate

- `tsc --noEmit` clean.
- No runtime tests here — covered by Task 6 e2e.

---

## Task 4 — Patient UI: Share button + doctor search

**Files:**
- `src/app/[locale]/(patient)/p/doctors/[doctorId]/documents/ShareDocumentButton.tsx` (new, client)
- `src/app/[locale]/(patient)/p/doctors/[doctorId]/documents/actions.ts` (new, server)
- `src/app/[locale]/(patient)/p/doctors/[doctorId]/documents/page.tsx` (modified)

### `actions.ts`

Two server actions:

```ts
'use server'

// Search doctors by name/specialty (for the share dialog).
searchDoctorsAction(query: string): Promise<{ id: string; name: string; specialty: string }[]>

// Share a document with a doctor.
shareDocumentAction(prev: ShareState, fd: FormData): Promise<ShareState>
  // fd: { documentId, targetDoctorId }
  // validates, calls shareDocument(), revalidates path

// Revoke a share.
revokeShareAction(prev: ShareState, fd: FormData): Promise<ShareState>
  // fd: { shareId, linkId }
  // validates, calls revokeShare(), revalidates path
```

`searchDoctorsAction` queries `DoctorProfile` where `isPublished = true` and
name matches (case-insensitive `contains`). Returns at most 10 results.

### `ShareDocumentButton.tsx`

Client component. Props: `{ documentId: string; locale: string; hasShare: boolean; shareDoctorName?: string; shareId?: string }`.

Two states:
1. **Not shared** → "Partager" button. On click: opens Dialog with search
   field + results list + confirm button.
2. **Shared** → badge "Partagé avec Dr. B" + "Révoquer" button. On click:
   confirm dialog → revokeShareAction.

Uses Radix Dialog (already in the project) and the existing `searchDoctorsAction`.

### `page.tsx` modification

The patient documents page currently renders `<DocumentList documents={rows} />`
with no `actions` prop. Add:

```tsx
<DocumentList
  documents={rows}
  locale={locale}
  actions={(doc) => (
    doc.status === 'ACTIVE' ? (
      <ShareDocumentButton
        documentId={doc.id}
        locale={locale}
        hasShare={shareMap.has(doc.id)}
        shareDoctorName={shareMap.get(doc.id)?.doctorName}
        shareId={shareMap.get(doc.id)?.id}
      />
    ) : null
  )}
/>
```

Where `shareMap` is built from a `findMany` on `DocumentShare` for the
documents on this link (batch query, not per-row).

### Verification gate

- `tsc --noEmit` clean.
- `npx next build` clean (or at least this route compiles).

---

## Task 5 — Doctor UI: "Shared with me" page

**Files:**
- `src/app/[locale]/(doctor)/d/shared-documents/page.tsx` (new, server)
- `src/app/[locale]/(doctor)/d/layout.tsx` (modified: add nav entry)

### `page.tsx`

Server component, `force-dynamic`. Pattern mirrors other doctor pages:

```tsx
const actor = await getCurrentActor();
if (!actor) redirect(`/${locale}/login`);
if (!hasPermission(actor, 'document:read')) notFound();

const docs = await listSharedDocuments(actor, locale);
```

Renders `<DocumentList>` with the shared documents. Each row shows:
- Patient name (from `sharedByPatientName`)
- Document type + version
- Share date (from `sharedAt`)
- Status badge (ACTIVE/SUPERSEDED/REVOKED)
- Download link to `/api/documents/{id}`

If the shared document's link also exists between this doctor and the patient
(i.e., the doctor has both a share AND a real link), the patient name links to
`/d/patients/{linkId}`. Otherwise, the patient name is plain text (the doctor
knows who shared, but has no treatment relationship).

### Layout modification

Add nav entry:

```ts
{ href: '/d/shared-documents', label: ar ? 'مستندات مشتركة' : 'Documents partagés' },
```

### Verification gate

- `tsc --noEmit` clean.
- `npx next build` clean.

---

## Task 6 — i18n keys

**Files:** `messages/fr.json`, `messages/ar.json`.

Add share-related keys:

```json
{
  "share": {
    "button": "Partager",
    "title": "Partager ce document",
    "searchPlaceholder": "Rechercher un médecin…",
    "searchNoResults": "Aucun médecin trouvé",
    "confirm": "Partager l'ordonnance avec {doctor} ?",
    "success": "Document partagé avec succès.",
    "alreadyShared": "Ce document est déjà partagé avec ce médecin.",
    "badge": "Partagé avec {doctor}",
    "revoke": "Révoquer",
    "revokeConfirm": "Révoquer le partage avec {doctor} ?",
    "revokeSuccess": "Partage révoqué.",
    "notActive": "Impossible de partager un document révoqué ou remplacé.",
    "doctorNotFound": "Médecin introuvable."
  },
  "sharedDocuments": {
    "title": "Documents partagés",
    "empty": "Aucun document partagé avec vous.",
    "sharedBy": "Partagé par {patient}",
    "sharedOn": "le {date}"
  }
}
```

Arabic translations follow the same structure.

### Verification gate

- `tsc --noEmit` clean.

---

## Task 7 — e2e tests

**Files:** `scripts/e2e-documents.ts` (extended), `package.json` (no new script needed).

Add to existing e2e:

1. **Share flow:** patient shares document with another doctor → `DocumentShare`
   row created, status ACTIVE.
2. **Download via share:** shared doctor downloads → 200, checksum verified,
   audit row with `via: 'share'`.
3. **Share pins version:** supersede original → share still on v1, not on v2.
4. **Revoke share:** revoke → doctor gets 404 on next download.
5. **Revoke document:** document revoked → share exists but download returns
   REVOKED status (200, not 404).
6. **Cross-patient isolation:** patient A cannot share patient B's document
   → `ResourceNotFoundError`.
7. **Doctor cannot share:** doctor tries `shareDocument` → permission denied
   (no `document:share` permission).
8. **RLS verification:** a raw SQL query from a different doctor context
   cannot read shared documents without the app-layer guard.

### Verification gate

- `npm run e2e:documents` → all pass including new share assertions.

---

## Task 8 — Verification sweep

Full sweep:
- `tsc --noEmit` clean.
- `npm test` green (existing unit tests).
- `npm run lint` clean.
- `next build` clean.
- `npm run e2e:documents` green (including new share tests).
- Browser: patient shares → doctor sees in "shared with me" → download works.

---

## Self-review checklist

- Spec coverage: schema ✓(1) guard ✓(2) domain ✓(3) patient UI ✓(4) doctor UI ✓(5) i18n ✓(6) e2e ✓(7).
- Types consistent: `ShareView`, `SharedDocumentView`, `DocumentRow` aligned.
- §2 boundary: share is per-document, per-doctor, patient-initiated, audited.
  No implicit cross-doctor record. Start tight.
- 404-not-403 preserved in `requireLinkOrShare`.
- RLS: third branch on `document_access` + `prescription_access` + new
  `document_share_doctor_access` policy.
- Known additions beyond minimal spec: doctor search action (Task 4) is
  necessary for the share UX.
