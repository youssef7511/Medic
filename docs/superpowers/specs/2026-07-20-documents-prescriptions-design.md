# Documents & Prescriptions — Design

**Date:** 2026-07-20
**Status:** Approved, ready for implementation planning
**Phase:** 4b (second of three sub-projects carved out of Phase 4)

---

## 1. Scope

A doctor issues a prescription to a patient they treat: fills structured
medication lines, reviews the patient's known allergies, and issues an immutable
PDF. The patient sees it in a document timeline and downloads it. Corrections
create a new version; a prescription issued in error can be revoked.

**In scope:** the whole document spine — S3-compatible storage, server-side PDF
generation, immutable issuance with versioning, app-proxied audited reads, the
patient document timeline — with **prescriptions as the first and only document
type**, including the §3.1 allergy-safety screen.

**Explicitly out of scope:**

| Deferred | Why |
|---|---|
| Other document types (lab order, report, certificate) | The engine is built type-agnostic, but only `PRESCRIPTION` ships now. Adding a type later is a template + a payload shape, not a re-architecture. |
| Digital / e-signature | §8 defers this for v1; the model leaves a nullable field. Several MENA markets are moving toward mandated e-prescription formats — a counsel conversation precedes implementing it. |
| Patient-initiated sharing (4c) | The first deliberate hole in the §2 boundary; its own spec. |
| Automated drug–allergy interaction checking | Needs a coded drug database and coded allergies we don't have. A fake check is more dangerous than none. |

---

## 2. Decisions

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| 1 | **PDF via `@react-pdf/renderer`.** | Puppeteer/headless Chrome; pdf-lib | No browser binary — keeps the app host-agnostic and self-hostable (§10), deterministic output, embeds Arabic fonts + RTL. A prescription is structured, not a magazine, so React-PDF's layout limits don't bite. |
| 2 | **Reads are app-proxied streaming, not signed URLs.** A route handler authorizes, audits, then streams bytes from storage. | Short-lived presigned URLs (the §8 suggestion) | No bearer-in-a-URL to leak or replay; the audit fires at the exact byte-serving moment (§10 wants *every* read audited); identical on any host; no dependency on a provider's presigning. Prescriptions are <100 KB, so proxying cost is negligible. **Deliberate override of §8.** |
| 3 | **Storage behind a narrow interface** (`putObject`/`getObject`/`deleteObject`), one S3 implementation via `@aws-sdk/client-s3`. | Vercel Blob or any host-coupled store | §10 mandates health-data residency in a fixed jurisdiction and a host-agnostic app. MinIO in Docker for dev; any S3-compatible provider in-region for prod. |
| 4 | **`Document` gains a lifecycle** (`ACTIVE`/`SUPERSEDED`/`REVOKED`); content stays immutable. A correction issues a new Document with `supersedesId`; an error is revoked with a reason. | Hard-immutable with no void | A wrongly-issued prescription a pharmacy might honour is a real safety issue — mirrors note retraction (4a). Content is never mutated; the lifecycle flag and versioning chain are the only changes. |
| 5 | **Prescription content = structured medication lines + encrypted payload.** Persisted encrypted; immutable PDF generated at issuance. | Free-text body; or store only the PDF | Structured data lets the timeline show contents without opening the PDF, supports the allergy screen, and is ready for future e-prescription formats (§8). |
| 6 | **Allergy screen: always-show + required acknowledgment**, with an encrypted snapshot at issuance. | Automated matching; passive display | Honest safety without a fake check; the acknowledgment + snapshot tie the doctor's review to a concrete record of what they saw. |

---

## 3. Data model

Extends the existing `Document` (already has `storageKey`, `checksum`,
`version`, `supersedesId`, `issuedByUserId` per §8); adds a lifecycle and a
`Prescription` sibling.

```prisma
enum DocumentStatus { ACTIVE SUPERSEDED REVOKED }

model Document {
  id             String         @id @default(cuid())
  linkId         String
  type           DocumentType
  status         DocumentStatus @default(ACTIVE)
  storageKey     String         // opaque object key; never a URL
  contentType    String         @default("application/pdf")
  byteSize       Int
  checksum       String         // sha256 hex of the stored bytes
  version        Int            @default(1)
  supersedesId   String?        @unique   // the Document this one replaces
  revokedAt      DateTime?      @db.Timestamptz(3)
  revokedBy      String?
  revokeReason   String?
  issuedByUserId String
  issuedAt       DateTime       @default(now()) @db.Timestamptz(3)

  link         PatientDoctorLink @relation(fields: [linkId], references: [id], onDelete: Cascade)
  supersedes   Document?         @relation("DocumentVersion", fields: [supersedesId], references: [id])
  supersededBy Document?         @relation("DocumentVersion")
  prescription Prescription?

  @@index([linkId, issuedAt])
}

/// Structured payload for a PRESCRIPTION document. 1:1 with Document.
/// All clinical free text is envelope-encrypted (§3.1, §10).
model Prescription {
  id                 String   @id @default(cuid())
  documentId         String   @unique
  /// Encrypted JSON: [{ drug, dose, frequency, durationDays, instructions }]
  medicationsEnc     Bytes
  notesEnc           Bytes?
  /// Encrypted snapshot of the patient's allergy state AT ISSUANCE, so the
  /// record proves what the doctor acknowledged reviewing.
  allergySnapshotEnc Bytes
  createdAt          DateTime @default(now()) @db.Timestamptz(3)

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
}
```

`supersedesId` is `@unique`: a given version can be superseded by at most one
successor, so the version chain is linear, not a tree.

All `DateTime` carry `@db.Timestamptz(3)` (Prisma's default drops the offset —
see §6 of `architecture-plan.md`).

RLS on `Document` already exists (`20260719000000_hardening`); the migration
extends the same doctor/patient policy to `Prescription` one hop out through the
document.

---

## 4. Storage abstraction

```
src/lib/storage/types.ts     ObjectStore interface
src/lib/storage/s3.ts        S3 impl (@aws-sdk/client-s3), targets MinIO or any S3
src/lib/storage/memory.ts    in-memory fake for unit tests
src/lib/storage/index.ts     getObjectStore() — selects by env
```

```ts
interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string }>;
  delete(key: string): Promise<void>;
}
```

Keys are opaque and unguessable: `documents/<cuid>/<random>.pdf`. Never derived
from patient identity. A key is not an authorization — every read is guarded
regardless (§4 below is the boundary, not the key).

Env: `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`,
`STORAGE_SECRET_KEY` (already stubbed in `.env.example`), plus
`STORAGE_REGION` and `STORAGE_FORCE_PATH_STYLE=true` for MinIO.

---

## 5. Access control

- **Issue** — `requireLink(actor, linkId, 'document:issue')`; `DOCTOR` only
  (`DOCTOR_STAFF` lacks it, §5).
- **Read/download** — `requireLinkAny(actor, linkId, ['document:read:own', 'document:read'])`,
  so either the owning patient or the treating doctor passes, each still proven
  on the link. A new `document:read` permission is added for `DOCTOR` (issuing
  implies reading back); patients keep `document:read:own`.
- **Revoke** — `requireLink(actor, linkId, 'document:issue')`; only the issuing
  practice voids.
- Out-of-scope → `ResourceNotFoundError` → 404, never 403 (§5).
- **Every read is audited** (§10) — `document.read`, with `patientId`, at the
  moment bytes are served. Issue and revoke are audited too.

Note the divergence from 4a: notes audited reads once-per-journal because only
the author reads them; documents audit *every* read because a document is the
thing that can be shared and can leave the practice.

---

## 6. Components

```
src/lib/documents/
  prescriptions.ts            domain: issue / revoke / supersede / get / list
  prescriptions.validation.ts pure: medication-line + allergy-state rules
  render.ts                   Document → { bytes, checksum }
  pdf/PrescriptionPdf.tsx     @react-pdf/renderer template (fr/ar, RTL)
  pdf/fonts/                  bundled Noto Sans Arabic + Latin .ttf
src/lib/clinical/allergies.ts read/classify patient allergy state (§3.1)
src/app/[locale]/(doctor)/d/patients/[linkId]/prescribe/
  page.tsx                    allergy panel + medication form (server + client)
  actions.ts                  issue / revoke server actions
src/app/[locale]/(doctor)/d/patients/[linkId]/documents/
  page.tsx                    documents for this link (doctor view)
src/app/[locale]/(patient)/p/doctors/[doctorId]/documents/
  page.tsx                    patient timeline
src/app/api/documents/[id]/route.ts   authorized streaming download
```

The download route sits at **top-level `/api`**, not under `[locale]` — the
next-intl middleware matcher only excludes top-level `/api`, so a route under
`[locale]/api` would wrongly get locale rewriting. This mirrors the existing
`/api/auth/[...nextauth]` route. Auth is cookie-based and locale-independent, so
nothing is lost.

Decryption and PDF rendering are server-only; ciphertext and raw bytes never
reach the browser except as the authorized streamed download.

### Domain surface

```ts
issuePrescription(actor, {
  linkId, medications, notes?, allergyAcknowledged
}): Promise<DocumentView>          // throws if not acknowledged

revokeDocument(actor, { documentId, reason }): Promise<DocumentView>
supersedePrescription(actor, { documentId, medications, notes?, allergyAcknowledged }): Promise<DocumentView>
getDocument(actor, documentId): Promise<{ meta; bytes; contentType }>   // download path
listDocuments(actor, linkId): Promise<DocumentView[]>                    // timeline
```

`DocumentView` is metadata only (type, status, version, issuedAt, doctor/patient
names, medication summary) — never the raw bytes.

### Limits

Named constants shared by validation, the form, and the tests:

| Constant | Value | Reason |
|---|---|---|
| `MAX_MEDICATION_LINES` | 30 | Far beyond a real prescription; bounds payload + PDF pages. |
| `DRUG_MAX_CHARS` | 200 | Drug name + form. |
| `DOSE_MAX_CHARS` | 100 | e.g. "500 mg". |
| `FREQUENCY_MAX_CHARS` | 100 | e.g. "3×/jour". |
| `DURATION_MAX_DAYS` | 365 | Sanity bound; a year is already unusual. |
| `INSTRUCTIONS_MAX_CHARS` | 500 | Per-line free text. |
| `NOTES_MAX_CHARS` | 2000 | Prescription-level notes. |
| `REVOKE_REASON_MIN_CHARS` | 10 | Same rationale as note retraction (4a). |
| `REVOKE_REASON_MAX_CHARS` | 500 | Metadata, not a second document. |

A medication line requires a non-empty `drug` and `dose`; `frequency`,
`durationDays`, and `instructions` are optional.

### Allergy state classification (§3.1)

```ts
type AllergyState =
  | { kind: 'listed'; text: string }   // allergiesEnc present
  | { kind: 'none' }                    // allergiesAffirmedNone = true
  | { kind: 'not_recorded' };           // neither — shown distinctly, NOT as "none"
```

The prescribing UI renders `not_recorded` as a visible amber "not recorded",
never a reassuring blank.

---

## 7. Issuance flow

Storage is not transactional with Postgres, so order matters:

1. `requireLink(... 'document:issue')`.
2. Validate medications; reject if `allergyAcknowledged` is false.
3. Read + classify current allergy state; encrypt a snapshot.
4. Render PDF → bytes + `sha256` checksum.
5. `store.put(key, bytes)` **first**.
6. `prisma.$transaction`: create `Document` + `Prescription`, audit `document.issue`.
7. If the transaction throws, `store.delete(key)` to clean the orphan (best
   effort; a leaked object is harmless — it is unreferenced and unreadable
   without a Document row to authorize it).

A crash between 5 and 6 leaves an orphaned object, never a dangling DB row — the
safe direction.

---

## 8. Failure modes

| Situation | Behaviour |
|---|---|
| `allergyAcknowledged` false | Issue rejected; button was disabled client-side, re-checked server-side. |
| Zero medication lines | Rejected. |
| Medication line missing drug or dose | Rejected with the offending line indicated. |
| Storage `put` fails | Issue fails atomically; no Document row written. |
| DB commit fails after `put` | Orphaned object cleaned up; error surfaced. |
| Download of a REVOKED/SUPERSEDED doc | Allowed — it is part of the record. Status is shown in the UI (timeline badge) and the record; the **stored PDF is never altered**, because it is immutable and checksummed. A revoked prescription's legal status lives in the data, not stamped onto a historical artifact. (Re-rendering to watermark would break the checksum — deliberately not done.) |
| Reader is neither the patient nor the treating doctor | 404. |
| `ENCRYPTION_MASTER_KEY` missing | Hard fail; no plaintext fallback. |

---

## 9. Testing

**Unit (no DB, in-memory store):**
- Medication validation: empty list, missing drug/dose, over-length, max lines.
- Allergy-state classification: listed / none / not_recorded from the three
  input combinations.
- Checksum determinism: same input → same sha256; different input → different.
- PDF render smoke: produces a non-empty `%PDF`-headed byte stream for fr and ar.

**End-to-end (real Postgres + MinIO):**
- Issue → `Document` + `Prescription` rows + object in storage; checksum matches
  the stored bytes.
- Medications persisted encrypted — raw column does not contain a drug name.
- Immutability: no update path mutates an issued Document's content.
- Supersede: new version, old → `SUPERSEDED`, chain linear.
- Revoke: status `REVOKED`, reason retained.
- Download authorizes and **audits every read**; second read writes a second
  audit row.
- Cross-doctor and cross-patient download → `ResourceNotFoundError`.

**Browser:**
- Doctor issues: allergy panel shows the patient's state; Issue disabled until
  acknowledgment; issued document appears in the timeline.
- Patient downloads their prescription from the timeline.
- `DOCTOR_STAFF` blocked from `/prescribe` and the download route (§5).

---

## 10. Follow-ups this design does not address

- **Patient-initiated sharing (4c).**
- **e-signature** and any mandated MENA e-prescription format (§8).
- **Retention/erasure** of documents when a link is archived or a doctor leaves
  (§10 — policy, not code).
- **Object lifecycle / backup** of the storage bucket in the chosen jurisdiction
  (ops, settled with the §10 hosting decision).
