# Medic

A platform where curated doctors get a public profile and a private practice
workspace, and patients book in-person appointments, exchange async messages,
and receive prescriptions and documents.

Three spaces, one codebase: **patient**, **doctor**, **super-admin** (RBAC).

> **Read [`docs/architecture-plan.md`](docs/architecture-plan.md) first.** It is
> the source of truth for every decision here — the security model, the data
> model, RBAC, booking, compliance, and the delivery phases. Section references
> (§2, §5, §10, …) throughout the code point back to it.

## The one idea to understand first

`PatientDoctorLink` is the security boundary (§2). A doctor can read a patient's
data **if and only if** an active link exists between them — not a role, not a
flag, that row. Every clinical path goes through `requireLink()` in
[`src/lib/rbac/guard.ts`](src/lib/rbac/guard.ts), and doctor routes are keyed by
`[linkId]`, never a raw `patientId`.

## Stack

Next.js 15 (App Router) · PostgreSQL + Prisma · Auth.js (credentials + TOTP) ·
next-intl (fr + **ar/RTL**) · Tailwind · pg-boss (jobs).

## Status — Phases 0, 2, 3 complete; Phase 4a + 4b complete

Built, tested, and building clean (116 unit + 62 end-to-end):

- **Data model** — full Prisma schema (§3) + hardening SQL (no-overlap
  exclusion constraint, RLS policies) in
  [`prisma/sql/001_hardening.sql`](prisma/sql/001_hardening.sql)
- **RBAC** (§5) — permission matrix + `requireLink` guard, deny-by-default and
  the "super-admin can't read clinical content" rule enforced by tests
- **Auth** (§10) — Auth.js v5 credentials, bcrypt, mandatory TOTP for
  doctor/staff/admin roles, DB-backed sessions with **immediate revocation**,
  account-enumeration defences, validated `next` redirects (7 tests)
- **Encryption** (§3.1) — AES-256-GCM envelope encryption with per-record data
  keys for clinical free text (7 tests)
- **Booking engine** (§6) — computed (never materialised) availability:
  rules − exceptions − booked − lead time − horizon, IANA-timezone correct
  incl. the Morocco DST trap (16 tests); booking transaction with link
  creation, auto-confirm (§13.2) and no-show gating (§13.4)
- **Appointment lifecycle** (§6) — state machine (9 tests) driving cancel,
  confirm/decline, complete and no-show; patient and doctor UIs
- **Notifications** (§6) — transactional outbox → pg-boss worker → SMS, with
  T-24h/T-2h reminders scheduled only for confirmed appointments (9 tests)
- **MFA enrollment** — QR-based first-login 2FA setup for privileged accounts
- **Consultation notes** (Phase 4a) — encrypted per-patient journal, immutable
  revision history, retract-with-reason (never deleted), server-side autosave
  with coalescing. Private to the authoring doctor; `DOCTOR_STAFF` and admins
  are blocked (§5, verified in-browser). 10 unit + 22 e2e checks.
- **Documents & prescriptions** (Phase 4b) — server-side PDF (React-PDF, fr/ar
  RTL, no browser binary), S3-compatible storage behind an interface (MinIO in
  dev), immutable issuance with versioning + revocation, **app-proxied audited
  downloads** (not signed URLs — no leakable bearer, every read audited §10),
  and the §3.1 allergy-safety screen: the patient's allergies are shown at
  prescribing and issuance is gated on the doctor's acknowledgment. Patient
  allergy self-service completes the loop. 11 unit + 19 e2e + a full in-browser
  pass incl. the §5 staff block (404 on prescribe and download).
- **Doctor calendar** (Phase 3) — week agenda with overlap lane-packing,
  working-hours bands, closed days (17 layout tests); custom-built rather than
  FullCalendar/react-big-calendar so RTL is correct by construction
- **Availability editor** (Phase 3) — weekly recurring windows + one-off
  exceptions, with overlap/slot-length validation (13 tests)
- **i18n + RTL** (§9) — fr/ar, locale routing, logical-property lint rule.
  Verified in a real browser: the whole grid mirrors, Monday lands on the right

Stubbed / not yet built (marked `TODO` in-code):

- **KMS** — `ENCRYPTION_MASTER_KEY` comes from env; production needs a real KMS
  (only `masterKey()` changes, §10)
- **SMS/email provider** — `getNotifier()` returns a console adapter, so
  **nothing is actually delivered yet**; wire the local aggregator
- **Enrollment hardening** — 2FA enrollment authenticates by password alone.
  An admin-issued single-use token (Phase 6) closes the pre-enrollment
  password-leak window
- Real fonts (system fallbacks, `src/app/globals.css` §9)
- Doctor calendar/availability editor (Phase 3), clinical/documents (Phase 4),
  messaging (Phase 5), admin (Phase 6)

### Running the worker

Notifications need the background worker alongside the app:

```bash
npm run worker     # drains the outbox onto pg-boss, then delivers
```

### End-to-end verification

Unit tests can't exercise the exclusion constraint, transactional rollback, or
the outbox — those need a real Postgres:

```bash
npm run db:up            # Postgres 16 in Docker on :55432
npm run db:storage       # MinIO (S3-compatible) in Docker on :9000
npm run db:storage:bucket # create the documents bucket (idempotent)
npm run db:migrate       # applies migrations incl. hardening, notes, documents
npm run e2e              # 21 checks incl. a genuine concurrent double-booking race
npm run e2e:notes        # 22 checks: encryption, revisions, retraction, isolation
npm run e2e:documents    # 19 checks: storage+checksum, lifecycle, per-read audit
```

Migrations now include the exclusion constraint and RLS
(`20260719000000_hardening`), so `db:harden` is only needed on a database that
predates it. `npm run e2e` is destructive — it truncates its own fixtures.
`npm run e2e:notes` is not; it makes uniquely-named fixtures and cleans them up.
Never point either at real data.

### Reviewing the UI

Drives the real app in Chromium through the full credentials + TOTP login, then
captures the calendar in both locales. This is the only way to verify the RTL
grid actually mirrors — no unit test can tell you Monday landed on the right:

```bash
npm run demo:seed      # fictional doctor + a populated week; prints the MFA secret
npm run build && npx next start -p 3100
BASE_URL=http://localhost:3100 MFA_SECRET=<from demo:seed> npm run demo:shots
# → .playwright-cli/calendar-fr.png, calendar-ar.png, availability-fr.png
```

> The booking flow needs `prisma/sql/001_hardening.sql` applied — without the
> exclusion constraint, concurrent bookings can double-book (§3).

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in DATABASE_URL etc.
npx prisma generate             # no database needed for this
npm run db:migrate              # needs a Postgres — see §10 on WHERE it lives
psql "$DATABASE_URL" -f prisma/sql/001_hardening.sql
npm run db:seed                 # fictional specialties only
npm run dev                     # http://localhost:3000 → /fr
```

## Scripts

| Script | Does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (incl. the §9 RTL rule) |
| `npm test` | RBAC invariant tests (Node test runner) |
| `npm run db:migrate` / `db:studio` / `db:seed` | Prisma |

## A compliance note you cannot skip (§10)

Health data (even "just the illness", §3.1) is Article-9-grade sensitive, and
MENA jurisdictions restrict transferring it abroad. **Where the database lives
is a legal decision, deadline = the first real patient row, not launch day.**
Keep the app host-agnostic until then (no provider-specific runtime primitives).
