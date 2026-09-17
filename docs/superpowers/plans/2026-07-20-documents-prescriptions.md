# Documents & Prescriptions Implementation Plan

> **STATUS: COMPLETE (2026-07-20).** All 11 tasks done and verified — 11 unit +
> 19 e2e (real Postgres + MinIO) green, production build clean, and the full
> patient-allergy → gated-issue → download loop plus the §5 staff block (404 on
> prescribe and download) confirmed in a real browser (`scripts/verify-documents-ui.ts`),
> in both fr and ar (RTL).
>
> **Deviations from plan, all recorded:**
> - Task 4 fonts: the *variable* Noto TTFs crash react-pdf's Arabic shaping;
>   swapped to **static** Noto Sans + Noto Sans Arabic TTFs.
> - PDFs are **not byte-deterministic** (react-pdf embeds a unique doc id); the
>   render test asserts the real integrity property (checksum == sha256 of the
>   returned bytes) instead of cross-render reproducibility. The download path's
>   guarantee is unaffected.
> - JSX-importing tsx runs need `--tsconfig tsconfig.tsx.json` (automatic runtime)
>   — the base tsconfig is `jsx: preserve` for Next.
> - Scope additions (flagged in the plan): the `document:read` permission and the
>   **patient allergy editor** (`/p/allergies`), without which the safety screen
>   could only ever read "not recorded".

> **For agentic workers:** implement task-by-task; each task ends at a green verification gate before the next begins.

**Goal:** A doctor issues an immutable PDF prescription to a patient they treat — structured medications, a mandatory allergy-review acknowledgment, encrypted payload, versioning and revocation — and both parties read it via an authorized, audited streaming download.

**Architecture:** Storage behind a narrow `ObjectStore` interface (S3/MinIO in prod-ish, in-memory fake in unit tests). PDFs rendered server-side with `@react-pdf/renderer` (no browser binary — host-agnostic per §10). `Document` (immutable, lifecycle `ACTIVE|SUPERSEDED|REVOKED`) + `Prescription` (encrypted structured payload + allergy snapshot). All access through the existing `requireLink`/`requireLinkAny` guard; every read audited (§10).

**Spec:** `docs/superpowers/specs/2026-07-20-documents-prescriptions-design.md`

## Global Constraints

- Host-agnostic (§10): no Vercel-specific primitives; storage behind an interface; `docker compose`-able.
- All clinical free text envelope-encrypted via `src/lib/crypto/envelope.ts` (`encryptText(s): Uint8Array<ArrayBuffer>`, `decryptText(buf): string`).
- Guard: `requireLink(actor, linkId, permission)` and `requireLinkAny(actor, linkId, permission[])` throw `ResourceNotFoundError` (→ 404, never 403) for out-of-scope.
- Timestamps: every Prisma `DateTime` carries `@db.Timestamptz(3)`.
- `@db.Date` for pure calendar dates.
- Tests: `node:test` via `tsx`; e2e scripts load `.env.local` through `tsx --env-file-if-exists`.
- Prescription is the ONLY document type shipped; the engine stays type-agnostic.

---

## Task 1 — Storage abstraction + MinIO

**Files:** `src/lib/storage/{types,memory,s3,index}.ts`, `src/lib/storage/memory.test.ts`; `package.json` (deps + scripts).

**Interface (produces):**
```ts
export interface StoredObject { body: Uint8Array; contentType: string }
export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;     // throws ObjectNotFoundError if absent
  delete(key: string): Promise<void>;          // idempotent
}
export class ObjectNotFoundError extends Error {}
export function newObjectKey(prefix: string): string; // `${prefix}/${cuid}/${randomHex}.pdf`
export function getObjectStore(): ObjectStore;         // memory if STORAGE_ENDPOINT unset, else S3
```

- `memory.ts`: a `Map<string, StoredObject>`; `get` on a missing key throws `ObjectNotFoundError`; `delete` is idempotent.
- `s3.ts`: `@aws-sdk/client-s3`. Config from env: `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_REGION` (default `us-east-1`), `forcePathStyle: true` (MinIO). `get` maps `NoSuchKey` → `ObjectNotFoundError`.
- `newObjectKey`: keys are opaque + random, never derived from patient identity.
- Deps: `npm i @aws-sdk/client-s3`.
- Scripts in `package.json`:
  - `db:storage`: `docker start medic-minio || docker run -d --name medic-minio -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=medic -e MINIO_ROOT_PASSWORD=medicminio minio/minio server /data --console-address ":9001"`
  - `db:storage:bucket`: create the bucket (a tiny `tsx` one-off using the S3 client, `CreateBucketCommand`, ignore `BucketAlreadyOwnedByYou`).

**Steps:** write `memory.test.ts` (put/get round-trips; get-missing throws; delete idempotent; two `newObjectKey` calls differ) → run, fail → implement types + memory + s3 + index → run, pass → typecheck → commit.

**Gate:** `npx tsx --test src/lib/storage/memory.test.ts` green; `npx tsc --noEmit` clean.

---

## Task 2 — Prescription validation + allergy classification (pure, TDD)

**Files:** `src/lib/documents/prescriptions.validation.ts`, `.test.ts`; `src/lib/clinical/allergies.ts` (classify only), `allergies.test.ts`.

**Produces:**
```ts
export const MAX_MEDICATION_LINES=30, DRUG_MAX_CHARS=200, DOSE_MAX_CHARS=100,
  FREQUENCY_MAX_CHARS=100, DURATION_MAX_DAYS=365, INSTRUCTIONS_MAX_CHARS=500,
  NOTES_MAX_CHARS=2000, REVOKE_REASON_MIN_CHARS=10, REVOKE_REASON_MAX_CHARS=500;

export interface MedicationLine { drug: string; dose: string; frequency?: string; durationDays?: number; instructions?: string }
export type MedsError = 'empty'|'too_many'|'line_missing_drug'|'line_missing_dose'|'line_too_long'|'duration_out_of_range';
export function validateMedications(lines: MedicationLine[]): MedsError | null;
export type RevokeError = 'reason_too_short'|'reason_too_long';
export function validateRevokeReason(reason: string): RevokeError | null;

// allergies.ts
export type AllergyState = { kind:'listed'; text:string } | { kind:'none' } | { kind:'not_recorded' };
export function classifyAllergy(input: { allergiesEnc: Uint8Array|null; allergiesAffirmedNone: boolean }): AllergyState;
```

- `classifyAllergy`: `allergiesEnc` present → `listed` (decrypt in the caller, not here — this takes the already-decrypted text; see note) … **correction:** to keep this pure and DB-free, signature takes `{ text: string|null; affirmedNone: boolean }` → `listed` if `text` non-empty, else `none` if `affirmedNone`, else `not_recorded`.
- `validateMedications`: empty list → `empty`; > MAX → `too_many`; any line missing trimmed drug/dose → the respective error; any field over its max → `line_too_long`; `durationDays` present and (<1 or >365) → `duration_out_of_range`.

**Tests:** each error branch + a valid case; classifier for the three combinations incl. `text=''` with `affirmedNone=true` → `none`, and both empty → `not_recorded`.

**Gate:** both test files green; `tsc` clean.

---

## Task 3 — Schema migration

**Files:** `prisma/schema.prisma`; `prisma/migrations/<ts>_documents_prescriptions/migration.sql`; `src/lib/rbac/permissions.ts`.

- Enum `DocumentStatus { ACTIVE SUPERSEDED REVOKED }`.
- `Document`: add `status DocumentStatus @default(ACTIVE)`, `contentType String @default("application/pdf")`, `byteSize Int`, `supersedesId String? @unique`, `revokedAt`, `revokedBy`, `revokeReason`, self-relation `DocumentVersion`, `prescription Prescription?`; change index to `@@index([linkId, issuedAt])`. (Note the existing `Document` already has `storageKey`, `checksum`, `version`, `supersedesId` — make `supersedesId` `@unique` and add the relation.)
- `Prescription` model per spec §3.
- Migration SQL: `CREATE TYPE "DocumentStatus"`; `ALTER TABLE "Document" ADD COLUMN`s (backfill `byteSize` default 0 then drop default); add `Document_supersedesId_key` unique + FK self-ref; `CREATE TABLE "Prescription"` + unique + FK; enable RLS on `Prescription` with a policy through the document → link → doctor/patient (mirror `note_revision_doctor_access` but allow patient too, matching the `Document` policy).
- `permissions.ts`: add `'document:read'` to the `PERMISSIONS` list and to the `DOCTOR` set. (Patient keeps `document:read:own`.)
- Apply: `export $(grep -E '^DATABASE_URL' .env.local | tr -d '"') && npx prisma migrate deploy && npx prisma generate`.

**Gate:** migration applies without a reset (existing data intact — verify appointment/note counts unchanged); `tsc` clean; a node one-liner confirms `prisma.prescription` and `DocumentStatus` exist.

---

## Task 4 — PDF rendering

**Files:** `src/lib/documents/pdf/PrescriptionPdf.tsx`, `src/lib/documents/pdf/fonts/*.ttf`, `src/lib/documents/render.ts`, `src/lib/documents/render.test.ts`; dep `@react-pdf/renderer`.

- Fonts: fetch **Noto Sans Arabic** (regular+bold) and **Noto Sans** (regular+bold) `.ttf` into `pdf/fonts/`. If the network is unavailable at build time, fall back to react-pdf's built-in Helvetica for Latin and register a single bundled Arabic ttf; **record which path was taken in the plan-execution notes.** Arabic MUST have an embedded face — Helvetica cannot render it.
- `PrescriptionPdf.tsx`: `Document`→`Page` with letterhead (doctor name + `Ordonnance`/`وصفة طبية`, licence number), clinic line, patient name + DOB, a medications table (drug / dose / frequency / duration / instructions), prescription notes, issue date, footer. `direction:'rtl'` and the Arabic font when `locale==='ar'`. Props: `{ locale, doctorName, licenseNumber, clinicName, patientName, patientDob, medications, notes, issuedAt }`.
- `render.ts`:
  ```ts
  export interface RenderedDocument { bytes: Uint8Array<ArrayBuffer>; checksum: string; byteSize: number }
  export async function renderPrescriptionPdf(input: PrescriptionRenderInput): Promise<RenderedDocument>;
  ```
  Uses `renderToBuffer` (from `@react-pdf/renderer`); `checksum = sha256hex(bytes)`; returns a real `Uint8Array<ArrayBuffer>` (copy, like the envelope module does) so it satisfies the `ObjectStore.put` type.

**Tests (`render.test.ts`):** rendering fr and ar each yields bytes starting with `%PDF`, `byteSize>1000`; identical input → identical checksum; a changed drug name → different checksum.

**Gate:** `render.test.ts` green; `tsc` clean. (If font fetch failed and Arabic fell back, note it and keep going — a follow-up swaps the font.)

---

## Task 5 — Domain layer

**Files:** `src/lib/documents/prescriptions.ts`, `src/lib/clinical/allergies.ts` (add DB read), `prescriptions.ts` domain.

**Produces:**
```ts
export interface DocumentView { id; type; status; version; issuedAt: Date;
  doctorName: string; patientName: string; medicationSummary: string;
  revokeReason: string|null; supersedesId: string|null }
export async function readAllergyState(prisma, patientId): Promise<AllergyState>; // decrypts, classifies
export async function issuePrescription(actor, args:{ linkId; medications; notes?; allergyAcknowledged:boolean }): Promise<DocumentView>;
export async function supersedePrescription(actor, args:{ documentId; medications; notes?; allergyAcknowledged }): Promise<DocumentView>;
export async function revokeDocument(actor, args:{ documentId; reason }): Promise<DocumentView>;
export async function getDocumentForDownload(actor, documentId): Promise<{ meta: DocumentView; bytes: Uint8Array; contentType: string }>;
export async function listDocuments(actor, linkId): Promise<DocumentView[]>;
export class DocumentValidationError extends Error { code: string }
```

- **issue** (spec §7 order): `requireLink('document:issue')`; validate meds; reject if `!allergyAcknowledged` (`DocumentValidationError('allergy_not_acknowledged')`); read+classify allergy, encrypt snapshot JSON; render PDF; `store.put(key)`; then `$transaction` create `Document`(status ACTIVE, version 1, checksum, byteSize, storageKey) + `Prescription`(medicationsEnc, notesEnc?, allergySnapshotEnc) + `audit('document.issue', patientId)`. On transaction throw → `store.delete(key)` best-effort, rethrow.
- **supersede**: load source via `requireLink('document:issue')` + author/ownership by link; must be a PRESCRIPTION and ACTIVE; issue a new Document `version = source.version+1`, `supersedesId = source.id`; in the same transaction set source `status = SUPERSEDED`; audit `document.supersede`.
- **revoke**: `requireLink('document:issue')`; validate reason; only ACTIVE→REVOKED; set `revokedAt/By/Reason`; audit `document.revoke`.
- **getDocumentForDownload**: `requireLinkAny(['document:read:own','document:read'])`; load meta + `store.get(storageKey)`; **audit `document.read` with patientId every call**; return bytes. Verify `sha256(bytes)===checksum`; on mismatch throw (tamper/corruption).
- **listDocuments**: `requireLinkAny(['document:read:own','document:read'])`; newest first; `medicationSummary` = first drug + "(+N)"; audit once per list view (like the notes journal).

**Gate:** `tsc` clean (no runtime test here; covered by Task 6 e2e).

---

## Task 6 — e2e (real Postgres + MinIO)

**Files:** `scripts/e2e-documents.ts`; `package.json` script `e2e:documents`.

Self-seeding, unique ids, cleans up (incl. `store.delete`), non-truncating. Checks:
- issue → `Document`+`Prescription` rows; object present in storage; `sha256(storedBytes)===checksum`.
- medications stored encrypted — raw `medicationsEnc` bytes do not contain a drug name string.
- issue rejected when `allergyAcknowledged=false`.
- allergy snapshot recorded (decrypts to the seeded state).
- download authorizes + audits: `getDocumentForDownload` twice → two `document.read` rows.
- supersede: new version, source `SUPERSEDED`, chain linear (`supersedesId` set, source `supersededBy` resolves).
- revoke: `REVOKED` + reason retained; a revoked doc cannot be superseded.
- cross-doctor and cross-patient `getDocumentForDownload` → `ResourceNotFoundError`.
- `listDocuments` for the other doctor's link → 404 / empty as appropriate.

**Gate:** `npm run db:storage && npm run db:storage:bucket` then `npm run e2e:documents` → `N passed, 0 failed`.

---

## Task 7 — Download route

**Files:** `src/app/api/documents/[id]/route.ts`.

- `runtime='nodejs'`. `GET`: `getCurrentActor()`; if none → 401. `getDocumentForDownload(actor, id)`; on `ResourceNotFoundError` → 404. Stream bytes with `Content-Type`, `Content-Disposition: inline; filename="ordonnance-<version>.pdf"`, `Cache-Control: private, no-store`. (Top-level `/api`, outside `[locale]`, so middleware doesn't touch it.)

**Gate:** build clean; a curl without a session → 401.

---

## Task 8 — Prescribing UI

**Files:** `src/app/[locale]/(doctor)/d/patients/[linkId]/prescribe/{page.tsx,PrescribeForm.tsx,actions.ts}`.

- `page.tsx` (server): `getCurrentActor` + `hasPermission('document:issue')` else `notFound()`; `readAllergyState`; render allergy panel (listed = amber box with text; none = green "Aucune allergie connue"; not_recorded = amber "Non renseignées"). Pass to client form.
- `PrescribeForm.tsx` (client): dynamic medication rows (add/remove), prescription notes, a required **"J'ai examiné les allergies connues"** checkbox; Issue button disabled until ≥1 valid line AND checkbox ticked. On submit → `issuePrescriptionAction`.
- `actions.ts`: `issuePrescriptionAction` (zod-parse medications JSON, call `issuePrescription`), `revokeDocumentAction`. Map `DocumentValidationError` → localized message; `ResourceNotFoundError` → not found.

**Gate:** build clean; `tsc`/lint clean.

---

## Task 9 — Timelines + patient allergy editor

**Files:** doctor `…/[linkId]/documents/page.tsx`; patient `…/p/doctors/[doctorId]/documents/page.tsx`; patient allergy editor `…/p/allergies/{page.tsx,AllergyForm.tsx,actions.ts}`; links from the doctor patient page and patient hub.

- **Timelines**: `listDocuments`; each row shows type, date, version, status badge (SUPERSEDED/REVOKED), medication summary, and a download link to `/api/documents/<id>`. Doctor timeline also links to `/prescribe` and offers revoke.
- **Patient allergy editor** (needed — the prescribing screen is hollow without a way to record allergies; §3.1): a textarea + a "Je n'ai aucune allergie médicamenteuse connue" checkbox (mutually exclusive with text). `saveAllergiesAction` uses `allergy:write:own`, encrypts text (or sets `allergiesAffirmedNone`), stamps `allergiesUpdatedAt`, audits `allergy.update`. **Flag to user at handoff — small scope addition beyond the spec's read-only allergy mention.**

**Gate:** build clean; `tsc`/lint clean.

---

## Task 10 — Browser verification

**Files:** `scripts/verify-documents-ui.ts`; a fixtures helper if needed.

Drive real browser: patient records an allergy → doctor logs in (TOTP), opens `/prescribe`, sees the allergy panel showing that allergy, Issue disabled until acknowledgment, issues a prescription → appears in doctor timeline → patient sees it in their timeline and the `/api/documents/<id>` download returns a `%PDF` with 200 → `DOCTOR_STAFF` gets 404 on `/prescribe` and on the download route. Assert, screenshot.

**Gate:** script prints `DOCUMENTS UI OK`.

---

## Task 11 — Docs

Update `README.md` (status, `e2e:documents`, `db:storage`) and append a 4b progress note to `docs/architecture-plan.md`. Mark this plan COMPLETE with any deviations (esp. the font path taken in Task 4).

**Gate:** full sweep — `tsc`, `npm test`, `npm run lint`, `next build`, `e2e`, `e2e:notes`, `e2e:documents` all green.

---

## Self-review checklist (run after writing, before executing)

- Spec coverage: storage ✓(1) validation ✓(2) model ✓(3) PDF ✓(4) domain+read-audit ✓(5) e2e ✓(6) streaming reads ✓(7) allergy screen ✓(8) timelines ✓(9) browser+staff-block ✓(10).
- Types consistent across tasks: `ObjectStore`, `RenderedDocument`, `DocumentView`, `AllergyState`, `MedicationLine` defined once, consumed as written.
- Known additions beyond spec, flagged: **patient allergy editor (Task 9)**; **`document:read` permission (Task 3)**.
- Risk: Arabic font fetch may fail offline — Task 4 has a fallback and records which path was taken.
