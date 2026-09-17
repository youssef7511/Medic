# Patient-Initiated Document Sharing — Design

**Date:** 2026-08-24
**Status:** Approved, ready for implementation planning
**Phase:** 4c (third of three sub-projects carved out of Phase 4)

---

## 1. Scope

A patient shares one of their documents (a prescription issued by Doctor A) with
Doctor B — a doctor who has never treated them on this platform. This is the
**first deliberate hole in the §2 link boundary**: a patient-authored,
per-document, audited grant that lets a foreign doctor read one immutable
artifact without opening any other clinical surface.

**In scope:** the `DocumentShare` grant model, the guard extension that
authorizes shared reads, the patient share/revoke UI, the doctor "shared with
me" view, RLS policy updates, and the full audit trail.

**Explicitly out of scope:**

| Deferred | Why |
|---|---|
| Share via link / magic URL | Bearer-in-URL violates §4b's "no signed URLs" posture; the share is identity-bound. |
| Share expiration | Adds background cleanup; v1 uses patient-initiated revocation. Revisit with real usage. |
| Batch sharing (share all docs with one doctor) | Each share is a deliberate per-document action. Batch can be layered on later. |
| Doctor-to-doctor sharing | Only the owning patient may share. Doctor A cannot push a document to Doctor B. |
| Shared notes | Notes are private to the authoring doctor (§2). Sharing never applies to notes. |
| Automatic share on booking | Explicit patient action only; no implicit cross-doctor record (§2, §13.1). |

---

## 2. Decisions

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| 1 | **Share pins the exact `documentId`.** Superseding creates a new version; the patient must explicitly share it. | Share follows the version chain | A share is a deliberate patient action. Silently propagating to versions the patient hasn't reviewed violates the "deliberate" principle. The superseded document stays accessible via its original share. |
| 2 | **Target doctor does NOT require a `PatientDoctorLink`.** The share records `targetDoctorId` directly. | Force a link first | A link opens appointments, messages, notes — far broader than "share one document." A share is the narrowest possible hole. |
| 3 | **Patient searches the doctor directory to select a target.** The directory is public (§4, Phase 1). | Paste doctor ID / share via URL | Paste is hostile UX; URLs leak. Search is discoverable and confirmable. |
| 4 | **"Shared with me" is a separate doctor page** (`/d/shared-documents`), not injected into the per-patient timeline. | Inject into existing timeline | The existing timeline is scoped to a specific patient link. Shared docs come from patients the doctor may not have a link with. Separate page avoids confusion. |
| 5 | **No expiration — revocation only.** Shares persist until the patient revokes them. | Time-limited shares | Adds a background cleanup job and stale-share semantics. v1 is simpler; expiration is a config-layer addition later. |
| 6 | **Document revoked → shares become unreadable.** The share row stays but the download path returns the REVOKED status. | Delete shares on revocation | A revoked document is still part of the record; the share revocation is a separate patient action with its own audit row. |
| 7 | **RLS extended with a third branch** for share-mediated access, not a separate policy. | Separate policy | Fewer policies = simpler reasoning. The existing `document_access` policy grows an `OR` clause. |

---

## 3. Data model

```prisma
enum ShareStatus {
  ACTIVE
  REVOKED
}

model DocumentShare {
  id             String      @id @default(cuid())
  documentId     String
  doctorId       String      // target doctor — may have no link to the patient
  sharedByUserId String      // must be the owning patient (enforced in app layer)
  status         ShareStatus @default(ACTIVE)
  createdAt      DateTime    @default(now()) @db.Timestamptz(3)
  revokedAt      DateTime?   @db.Timestamptz(3)

  document Document      @relation(fields: [documentId], references: [id], onDelete: Cascade)
  doctor   DoctorProfile @relation(fields: [doctorId], references: [id], onDelete: Cascade)

  @@unique([documentId, doctorId])
  @@index([doctorId, status])
}
```

`Document` gains a `shares DocumentShare[]` relation.

### Why not alternatives

- **No `PatientDoctorLink` for the target doctor.** That would expose
  appointments, messages, and notes surfaces — far broader than "share one
  document," and collides with the `@@unique([patientId, doctorId])` constraint
  if a real relationship later forms. §13.1: "start tight."
- **No doctor array on `Document`.** Unnormalized; version chains would make
  "which row holds the ACL" ambiguous.
- **No separate ACL table per document.** A single `DocumentShare` row per
  (document, doctor) pair is sufficient and queryable.

---

## 4. Access control

### Share creation (patient side)

- **Permission:** `document:share` (PATIENT only, already declared in §5).
- **Guard:** `requireLink(actor, linkId, 'document:share')` proves the actor is
  the patient on this link. Then verify the document is on this link (defense in
  depth — the link already scopes this, but the loaded document confirms it).
- **Validation:** document must be `ACTIVE` (cannot share revoked/superseded);
  target doctor must exist; share must not already exist (upsert is idempotent
  on the `@@unique`).

### Share read (doctor side)

- **Permission:** `document:read` (DOCTOR only).
- **Guard extension:** `getDocumentForDownload` and `listSharedDocuments` use a
  new `requireLinkOrShare(actor, documentId, 'document:read')` that succeeds if:
  1. `requireLinkAny(actor, doc.linkId, ['document:read:own', 'document:read'])`
     passes (same-link access), **OR**
  2. The actor is a DOCTOR with an ACTIVE `DocumentShare` on this document.
- **Out-of-scope → 404** (§5). A doctor who has neither a link nor a share
  gets the same 404 as a non-existent document.

### Share revocation (patient side)

- **Permission:** `document:share` (same as creation).
- **Guard:** verify the share belongs to the patient's document via the link.

### RLS update

The `document_access` policy on `Document` and the `prescription_access`
policy on `Prescription` grow a third branch:

```sql
-- Existing: doctor-of-link OR patient-of-link
-- New:     doctor-of-link OR patient-of-link OR (active share to current doctor)
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
```

Same pattern for `prescription_access` (hop through `Document` →
`DocumentShare`).

---

## 5. Domain surface

```ts
// Share a document with another doctor.
shareDocument(actor, {
  documentId,
  targetDoctorId,
}): Promise<ShareView>

// Revoke a share.
revokeShare(actor, {
  shareId,
}): Promise<ShareView>

// List all documents shared WITH this doctor (across all patients).
listSharedDocuments(actor, locale?): Promise<SharedDocumentView[]>

// Extended download authorization (existing function, share branch added).
getDocumentForDownload(actor, documentId):
  Promise<{ meta: DocumentView; bytes: Uint8Array; contentType: string }>
```

```ts
interface ShareView {
  id: string;
  documentId: string;
  doctorName: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: Date;
  revokedAt: Date | null;
}

interface SharedDocumentView extends DocumentView {
  sharedByPatientName: string;
  sharedAt: Date;
}
```

### Audit events

| Event | When | metadata |
|---|---|---|
| `document.share` | Share created (in-tx) | `{ targetDoctorId, documentType }` |
| `document.share.revoke` | Share revoked (in-tx) | `{ shareId, targetDoctorId }` |
| `document.read` | Download via share | `{ via: 'share', shareId }` (added to existing event) |

---

## 6. Components

### Patient side — modifications to existing timeline

```
src/app/[locale]/(patient)/p/doctors/[doctorId]/documents/
  page.tsx                    modified: pass share actions to DocumentList
  ShareDocumentButton.tsx     NEW: client — doctor search + confirm dialog
  actions.ts                  NEW: shareDocumentAction, revokeShareAction
```

The existing `DocumentList` component gains an optional `shareIndicator` render
prop (like the existing `actions` render prop) to show share status and the
revoke control per row.

### Doctor side — new "shared with me" page

```
src/app/[locale]/(doctor)/d/shared-documents/
  page.tsx                    NEW: lists all documents shared with this doctor
```

This page queries `listSharedDocuments` — documents from any patient where an
active share exists for this doctor. Each row shows patient name, document type,
share date, and a download link. Links to the patient overview if a link exists
between this doctor and the patient; otherwise shows the patient name only.

### Doctor layout — add nav link

The doctor layout (`src/app/[locale]/(doctor)/d/layout.tsx`) gains a "Documents
partagés" / "مستندات مشتركة" nav entry pointing to `/d/shared-documents`.

### Domain layer

```
src/lib/documents/sharing.ts          NEW: share/revoke/list domain functions
src/lib/documents/prescriptions.ts    MODIFIED: share branch in getDocumentForDownload
src/lib/rbac/guard.ts                 MODIFIED: requireLinkOrShare helper
```

---

## 7. Flows

### Patient shares a document

```
Patient timeline → click "Partager" on an ACTIVE document row
  → ShareDocumentButton opens Dialog:
      - Search field: type doctor name → hits a server action that queries
        DoctorProfile (published only) by name/specialty
      - Results list: doctor name, specialty, select
      - Confirm: "Partager l'ordonnance v1 avec Dr. B ?"
      - Submit → shareDocumentAction
        1. getCurrentActor() → PATIENT
        2. requireLink(actor, linkId, 'document:share')
        3. Load document — must be on this link, must be ACTIVE
        4. Load target doctor — must exist and be published
        5. Upsert DocumentShare (idempotent on @@unique)
        6. Audit: document.share
        7. revalidatePath → timeline refreshes
  → Success: share badge appears on the document row
```

### Doctor downloads a shared document

```
Doctor opens /api/documents/{id} OR listSharedDocuments includes the doc
  → getDocumentForDownload:
      1. Load document + link
      2. requireLinkAny(['document:read:own','document:read']) — same-link first
      3. If ResourceNotFoundError → check share:
         SELECT * FROM "DocumentShare"
         WHERE documentId = doc.id AND doctorId = doctorProfile.id AND status = 'ACTIVE'
      4. If share found → proceed (serve bytes, checksum, audit with { via: 'share' })
      5. If neither → ResourceNotFoundError → 404
```

### Doctor views "shared with me"

```
/d/shared-documents (new route)
  → listSharedDocuments(actor):
      1. Load doctorProfile for actor
      2. SELECT d.*, ds.createdAt as sharedAt, pp.firstName, pp.lastName
         FROM "DocumentShare" ds
         JOIN "Document" d ON d.id = ds.documentId
         JOIN "PatientDoctorLink" l ON l.id = d.linkId
         JOIN "PatientProfile" pp ON pp.id = l.patientId
         WHERE ds.doctorId = doctorProfile.id AND ds.status = 'ACTIVE'
         ORDER BY ds.createdAt DESC
      3. Audit: document.share_list
  → Render: DocumentList with sharedBy patient name and share date
```

### Patient revokes a share

```
Patient timeline → on a shared document row, show "Partagé avec Dr. B — révoquer"
  → Confirm dialog
  → revokeShareAction:
      1. getCurrentActor() → PATIENT
      2. requireLink(actor, linkId, 'document:share')
      3. Load share — verify it belongs to a document on this link
      4. Set status = REVOKED, revokedAt = now
      5. Audit: document.share.revoke
  → Doctor loses access immediately (share check fails on next request)
```

---

## 8. Failure modes

| Situation | Behaviour |
|---|---|
| Patient tries to share a REVOKED document | Rejected ("document révoqué") |
| Patient tries to share a SUPERSEDED document | Rejected ("document remplacé") |
| Share already exists (same doc + doctor) | Idempotent — returns existing share, no duplicate |
| Target doctor doesn't exist | Rejected ("Médecin introuvable") |
| Target doctor not published | Rejected — unpublished profiles are not share targets |
| Doctor tries to download shared doc after share revoked | 404 (same as non-existent) |
| Doctor tries to download shared doc after document revoked | 200 — REVOKED status shown, PDF still served (it's part of the record) |
| Patient has no link to the target doctor | Fine — share is document-level, not link-level |
| Share created, then patient link to the sharing doctor is blocked | Share remains active — share is document-level, independent of links |

---

## 9. Testing

**Unit (no DB):**
- `requireLinkOrShare` logic: succeeds on same-link, succeeds on share, fails
  on neither, fails on REVOKED share.
- Share validation: reject share on non-ACTIVE document, reject duplicate share.

**End-to-end (real Postgres):**
- Patient shares document → doctor downloads → audited.
- Share pinned: supersede original → share still on original, not on new version.
- Revoke share → doctor gets 404.
- Revoke document → share exists but download returns REVOKED status.
- Cross-patient isolation: patient A cannot share patient B's document.
- Doctor cannot share (only patient holds `document:share`).
- RLS: a missing WHERE clause cannot leak shared documents across patients.

**Browser:**
- Patient timeline shows Share button on ACTIVE documents.
- Share dialog: search doctor → select → confirm → share badge appears.
- Doctor "shared with me" page shows the shared document with patient name.
- Download from shared page works; revoke removes access.

---

## 10. Follow-ups

- **Share expiration.** A configurable TTL (e.g. 90 days) with a background
  cleanup job. Needs: `expiresAt` field on `DocumentShare`, a pg-boss handler.
- **Batch share.** "Share all my documents with Dr. B" — a convenience action
  that creates one share per ACTIVE document.
- **Doctor notification.** When a patient shares a document, the doctor receives
  an in-app notification (Phase 5 messaging) or SMS.
- **Share audit dashboard.** A patient-facing view of "who has accessed my
  documents" built on the `document.share` and `document.read` audit events.
