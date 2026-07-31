# Medic — Architecture & Delivery Plan

**Status:** Draft v1 — for review
**Date:** 2026-07-16

---

## 1. What we're building

A platform where a curated set of doctors each get a public profile and a private practice workspace, and patients book in-person appointments, exchange async messages, and receive prescriptions and documents.

**Decided:**

| Decision | Choice |
|---|---|
| Consultation modality | In-person booking + async chat + prescriptions/documents. **No video in v1.** |
| Patient identity | One global account; a per-doctor relationship scopes access |
| Payments | None in v1 — patient pays the doctor directly |
| Stack | Next.js (App Router) + PostgreSQL + Prisma |
| Jurisdiction | North Africa / MENA, designed to a GDPR-shaped baseline |
| Languages | French + Arabic (RTL) from day one |

**Three spaces, one codebase:** patient, doctor, super-admin.

---

## 2. The central idea: the link is the security boundary

Everything in this design hangs off one table. Get this right and the rest follows.

A patient has **one account**. A doctor has **one practice**. Between them sits a `patient_doctor_link` — created the first time a patient books with or registers under a doctor. That link is what a doctor's access is scoped to. Not a role, not a flag. **A doctor can read a patient's data if and only if an active link exists between them.**

```
User (auth identity)
 ├── PatientProfile ──┐
 └── DoctorProfile ───┤
                      │
              PatientDoctorLink  ← every clinical read/write is scoped through here
                      │
        ┌─────────────┼──────────────┬─────────────┐
   Appointments   MessageThread   Documents   ConsultationNotes
```

### The sharing question you need to answer

A patient sees Doctor A, then Doctor B. **Does B see A's notes?**

My recommendation, and what this plan assumes:

- **Consultation notes are private to the authoring doctor.** They are A's clinical reasoning, not a shared record. B never sees them.
- **Documents (prescriptions, lab reports) belong to the patient.** They live in the patient's timeline. The patient can explicitly share a document with another doctor — an action that is logged.
- **There is no implicit cross-doctor record.** Nothing leaks between practices without a deliberate patient action.

This is the conservative, defensible position. It also means a doctor cannot see a full history unless the patient shares it — which is a real clinical limitation you should accept knowingly rather than discover later. If you want a shared record, that's a different product with a much heavier consent model, and we should decide now, not in Phase 4.

---

## 3. Data model

Prisma sketch — abbreviated to the load-bearing parts.

```prisma
model User {
  id            String   @id @default(cuid())
  email         String?  @unique
  phone         String?  @unique
  passwordHash  String?
  emailVerified DateTime?
  locale        String   @default("fr")
  status        UserStatus @default(ACTIVE)  // ACTIVE, SUSPENDED, DELETED
  mfaSecret     String?                       // required for DOCTOR + ADMIN
  createdAt     DateTime @default(now())

  patientProfile PatientProfile?
  doctorProfile  DoctorProfile?
  roleAssignments RoleAssignment[]
  consents       Consent[]
}

model DoctorProfile {
  id           String  @id @default(cuid())
  userId       String  @unique
  slug         String  @unique          // /fr/doctors/dr-amine-benali
  specialtyId  String
  licenseNumber String                  // verified by super-admin before publish
  bio          Json                     // { fr: "...", ar: "..." }
  headline     Json
  photoUrl     String?
  languages    String[]
  isPublished  Boolean @default(false)  // super-admin gates this
  autoConfirm  Boolean @default(false)  // §13.2: vet bookings by default
  timezone     String  @default("Africa/Tunis")

  clinics      Clinic[]
  availability AvailabilityRule[]
  links        PatientDoctorLink[]
}

model PatientProfile {
  id          String   @id @default(cuid())
  userId      String   @unique
  firstName   String
  lastName    String
  dateOfBirth DateTime
  sex         Sex
  phone       String

  // No structured medical history. See §3.1 — the patient's clinical
  // footprint is: reason-for-visit per appointment, the doctor's notes,
  // issued documents, and known drug allergies. Nothing else.
  //
  // Known drug allergies: the one structured clinical field we keep, for
  // prescribing safety. Envelope-encrypted, nullable, patient-editable,
  // surfaced on the doctor's prescribing screen. See §3.1 and §8.
  allergiesEnc Bytes?
}

/// The security boundary. Every clinical query joins through this.
model PatientDoctorLink {
  id        String @id @default(cuid())
  patientId String
  doctorId  String
  status    LinkStatus @default(ACTIVE)  // ACTIVE, ARCHIVED, BLOCKED
  createdAt DateTime @default(now())
  source    LinkSource                   // BOOKING, DOCTOR_INVITE, IMPORT

  appointments Appointment[]
  threads      MessageThread[]
  documents    Document[]
  notes        ConsultationNote[]

  @@unique([patientId, doctorId])
  @@index([doctorId, status])
}

model Clinic {
  id        String @id @default(cuid())
  doctorId  String
  name      String
  address   Json                  // { line1, city, postalCode, country, geo }
  phone     String?
}

/// Recurring weekly availability, expressed in the doctor's local timezone.
model AvailabilityRule {
  id           String @id @default(cuid())
  doctorId     String
  clinicId     String
  weekday      Int          // 0-6
  startLocal   String       // "09:00"
  endLocal     String       // "13:00"
  slotMinutes  Int    @default(20)
  validFrom    DateTime
  validUntil   DateTime?
}

/// One-off overrides: holidays, conferences, extra clinics.
model AvailabilityException {
  id        String @id @default(cuid())
  doctorId  String
  date      DateTime @db.Date
  isClosed  Boolean  @default(true)
  startLocal String?
  endLocal   String?
}

model Appointment {
  id          String @id @default(cuid())
  linkId      String
  clinicId    String
  startAt     DateTime          // always UTC
  endAt       DateTime
  status      AppointmentStatus // REQUESTED, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW
  reason      String?
  cancelledBy String?
  cancelReason String?

  @@index([clinicId, startAt])
}

/// Doctor's private clinical reasoning. Never crosses a practice boundary.
model ConsultationNote {
  id            String @id @default(cuid())
  linkId        String
  appointmentId String?
  contentEnc    Bytes             // envelope-encrypted
  authorUserId  String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

/// Belongs to the patient. Immutable once issued; corrections create a new version.
model Document {
  id          String @id @default(cuid())
  linkId      String
  type        DocumentType   // PRESCRIPTION, LAB_ORDER, REPORT, CERTIFICATE
  storageKey  String         // private bucket; served via short-lived signed URL
  checksum    String
  version     Int    @default(1)
  supersedesId String?
  issuedAt    DateTime @default(now())
  issuedByUserId String
}

model MessageThread {
  id           String @id @default(cuid())
  linkId       String
  subject      String?
  lastMessageAt DateTime?
  closedAt     DateTime?
  messages     Message[]
}

model Message {
  id        String @id @default(cuid())
  threadId  String
  senderUserId String
  bodyEnc   Bytes
  attachments Json?
  readAt    DateTime?
  createdAt DateTime @default(now())
}

/// Append-only. Never updated, never deleted by application code.
model AuditLog {
  id           String   @id @default(cuid())
  actorUserId  String?
  actorRole    String
  action       String   // "document.read", "note.update", "patient.search"
  resourceType String
  resourceId   String
  patientId    String?  // denormalized: answers "who touched this patient's data?"
  ip           String?
  userAgent    String?
  metadata     Json?
  createdAt    DateTime @default(now())

  @@index([patientId, createdAt])
  @@index([actorUserId, createdAt])
}
```

### 3.1 What health data we actually collect

Deliberately minimal. There is **no medical-history module** — no structured conditions list, no family history, no vitals, no medication log. The entire clinical footprint of a patient on this platform is four things:

| Data | Written by | Visible to |
|---|---|---|
| Reason for visit (free text, short) | Patient, at booking | That patient + that doctor |
| Known drug allergies | Patient | That patient + any doctor prescribing to them |
| Consultation notes | Doctor | That doctor only |
| Issued documents | Doctor | That patient + that doctor |

Nobody else. Not support, not super-admin. The link is the boundary and there is nothing outside it.

**Allergies is the one field with cross-doctor visibility, and that is intentional.** Reason-for-visit and notes are scoped to a single link. Allergies are not — every doctor who prescribes to this patient sees them, because an allergy the treating doctor can't see is an allergy that can't prevent a prescription. It's the patient's own declaration about their own body, surfaced wherever a prescription is written. This is a deliberate, narrow exception to the link boundary, applying to exactly one field. Read access is still audited like everything else.

This is a real scope cut — it removes a medical-history feature, its forms, its versioning, and its migration surface from the build. Take it.

**What it does not change.** Sensitivity is about what one row means, not how many rows there are. A single reason-for-visit reading *suspected tuberculosis* or *requesting HIV test* is Article 9 special-category data and would be a reportable breach on its own. So these three fields keep everything: envelope encryption, audit on every read, the link boundary, RLS, and the retention policy. Collecting less shrinks the target; it doesn't downgrade the defense. In fact concentration cuts the other way — when 100% of what you hold is the sensitive part, there's no low-value data to hide in.

**Known drug allergies — decided: in.**

Not for completeness — for safety. Phase 4 has doctors issuing prescriptions through this platform. A doctor prescribing amoxicillin to a penicillin-allergic patient is the single most common preventable prescribing harm there is, and if the prescription was issued through your product with no allergy field on the screen, that's your product's contribution to it.

One nullable, patient-editable, encrypted field, surfaced on the prescribing screen (§8). It is the single structured clinical field on the platform, and the single exception to the link boundary — see the visibility note above.

**Design consequence to hold onto: an empty allergies field is ambiguous.** It means either "no known allergies" or "never asked." Those are clinically opposite and a prescribing doctor must not confuse them. So the UI distinguishes them explicitly — a patient actively affirms *"no known drug allergies"* as a distinct state from *never filled in*, and the prescribing screen shows *"not recorded"* for the untouched case rather than a reassuring blank. Never render an empty field as if it were a clean bill.

### Two database-level guarantees worth the effort

**Double-booking is prevented by Postgres, not by application code.** Application-level checks lose races. Use an exclusion constraint:

```sql
ALTER TABLE appointments ADD COLUMN period tstzrange
  GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (clinic_id WITH =, period WITH &&)
  WHERE (status IN ('REQUESTED', 'CONFIRMED'));
```

Two concurrent bookings for the same slot: one commits, the other gets a constraint violation you translate into a friendly "just taken, pick another." This is unfalsifiable in a way an `if (existing) throw` never is.

**Row Level Security as a second line of defense.** The app layer is the primary guard (Section 5), but RLS on `consultation_notes`, `documents`, and `messages` means a bug in a query can't quietly exfiltrate another practice's data. Set `app.current_user_id` per transaction via a Prisma middleware and write policies against the link table. This costs about a day and buys a genuine "a missing WHERE clause cannot leak patient records" guarantee.

---

## 4. Routing & the three spaces

```
app/
  [locale]/
    (marketing)/
      page.tsx                        landing
      doctors/page.tsx                directory: search, filter by specialty/city
      doctors/[slug]/page.tsx         public profile — SSR, indexable
    (patient)/
      p/
        layout.tsx                    requires PATIENT
        page.tsx                      hub: all my doctors
        doctors/[doctorId]/           ← the per-doctor space
          page.tsx                    overview
          book/page.tsx
          appointments/page.tsx
          messages/page.tsx
          documents/page.tsx
        profile/page.tsx
    (doctor)/
      d/
        layout.tsx                    requires DOCTOR | DOCTOR_STAFF
        page.tsx                      today's schedule
        calendar/page.tsx
        availability/page.tsx
        patients/page.tsx
        patients/[linkId]/            ← scoped to the link, never a raw patientId
          page.tsx
          notes/page.tsx              DOCTOR only — staff blocked
          documents/page.tsx
        messages/page.tsx
        profile/page.tsx
    (admin)/
      admin/
        layout.tsx                    requires SUPER_ADMIN | SUPPORT_ADMIN
        doctors/page.tsx              onboarding, license verification, publish
        users/page.tsx
        roles/page.tsx
        audit/page.tsx
        settings/page.tsx
  api/
```

**Note the doctor route uses `[linkId]`, not `[patientId]`.** The URL itself carries the authorization scope. A doctor cannot type another patient's ID into the address bar and hope a check catches it — there's no route that accepts one.

### The entry flow you described

```
Landing → /doctors → /doctors/dr-amine-benali → "Book an appointment"
    ↓ not authenticated
/login?next=/p/doctors/{id}/book
    ↓ authenticate or register
Create PatientDoctorLink (source: BOOKING) if none exists
    ↓
/p/doctors/{id}/book  ← patient is now in their space, scoped to this doctor
```

The doctor context survives the auth redirect via the `next` param. Validate it against an allowlist of internal paths — an open redirect on a login page is a classic and it's free to prevent.

---

## 5. RBAC — and why roles alone aren't enough

Roles answer *what kind of action*. They don't answer *on whose data*. A doctor has `note:read` — but only for their own links. Both questions need answering on every request.

### Roles

| Role | Purpose |
|---|---|
| `PATIENT` | Own data only |
| `DOCTOR` | Full clinical access within their own practice |
| `DOCTOR_STAFF` | Secretary. Manages calendar and appointments. **Cannot read clinical notes.** Scoped to one or more doctors. |
| `SUPPORT_ADMIN` | Platform operations. Can see accounts and bookings, **not clinical content**. |
| `SUPER_ADMIN` | Everything, including role management |

`DOCTOR_STAFF` is worth building in v1 even if no one uses it immediately. Real clinics run on secretaries, and retrofitting a role that must be blind to clinical notes means re-auditing every query.

### Permissions and scope

```prisma
model RoleAssignment {
  id        String @id @default(cuid())
  userId    String
  role      Role
  scopeType ScopeType   // GLOBAL | DOCTOR
  scopeId   String?     // doctorId when scopeType = DOCTOR
  grantedBy String
  grantedAt DateTime @default(now())
  expiresAt DateTime?

  @@unique([userId, role, scopeId])
}
```

The scope is what lets one secretary work for two doctors, and what stops a `DOCTOR` role from meaning "any doctor's data."

### The guard

One module. Every clinical data path goes through it. No exceptions, enforced by code review and a lint rule.

```ts
type Actor = { userId: string; roles: RoleAssignment[] };

// Resolves the link AND verifies this actor may act on it.
// Throws NotFound (never Forbidden) when the link isn't theirs —
// "Forbidden" confirms the record exists, which is itself a leak.
async function requireLink(
  actor: Actor,
  linkId: string,
  permission: Permission
): Promise<PatientDoctorLink>
```

Two rules that matter:

- **Deny by default.** No permission entry means no access. Never `if (!denied) allow`.
- **Return 404, not 403, for out-of-scope resources.** A 403 tells an attacker the ID is real.

### Permission matrix

| | PATIENT | DOCTOR_STAFF | DOCTOR | SUPPORT_ADMIN | SUPER_ADMIN |
|---|---|---|---|---|---|
| Book / cancel own appointment | ✅ | — | — | — | — |
| View own documents | ✅ | — | — | — | — |
| Share a document with another doctor | ✅ | — | — | — | — |
| View doctor's calendar | — | ✅ scoped | ✅ own | — | — |
| Confirm / reschedule appointment | — | ✅ scoped | ✅ own | ⚠️ logged | ✅ logged |
| Read consultation notes | — | ❌ | ✅ own links | ❌ | ❌ |
| Write consultation notes | — | ❌ | ✅ own links | ❌ | ❌ |
| Issue prescription | — | ❌ | ✅ own links | ❌ | ❌ |
| Read patient messages | ✅ own | ❌ | ✅ own links | ❌ | ❌ |
| Verify license / publish doctor | — | — | — | ❌ | ✅ |
| Assign roles | — | — | — | ❌ | ✅ |
| Read audit log | — | — | — | ✅ | ✅ |
| Suspend account | — | — | — | ❌ | ✅ |

**Super-admin cannot read clinical notes or messages.** This is deliberate and I'd push back on changing it. An admin needs to run the platform, not read consultations. The moment "super admin sees everything" is true, every admin account becomes a total compromise of every patient record on the platform, and you lose the ability to tell a regulator that clinical data is accessible only to the treating physician. If a real support case needs it, build a break-glass flow: time-boxed, reason-required, patient-notified, loudly audited. Not a standing permission.

---

## 6. Booking engine

**Don't materialize slots.** A `slots` table pre-generated for every doctor is millions of rows, and every availability change means a migration of future rows. Compute instead:

```
available(doctor, clinic, dateRange) =
    expand(AvailabilityRule → slots in doctor's local tz)
  – AvailabilityException
  – existing Appointments (REQUESTED | CONFIRMED)
  – lead time (no booking < 2h out)
  – horizon (no booking > 60d out)
```

Cache per `(doctorId, clinicId, date)`, invalidate on any write to rules, exceptions, or appointments. The computation is cheap; the cache is for the doctor-profile page under load.

**Timezones.** Store every instant in UTC. Express availability rules in the doctor's local time (`Africa/Tunis`, `Africa/Casablanca`). Convert at the edges. Morocco's Ramadan DST shift is a real trap — do the arithmetic in a library that knows the IANA database, never with manual offsets.

> **Found in the first real-database run (2026-07-18):** "store in UTC" is not
> something a code comment can enforce. Prisma maps `DateTime` to
> `timestamp(3) **without** time zone` by default, and `@default(now())` on such
> a column resolves against the *server's* `TimeZone` setting — so a non-UTC
> host silently writes local wall-clock instants with no offset. It surfaced
> because `tstzrange()` is not immutable over a `timestamp` column, which made
> the exclusion constraint fail to build. Every instant field now carries
> `@db.Timestamptz(3)`, and `dateOfBirth` is `@db.Date` (a birthday must not
> shift a day under timezone conversion). Lesson worth keeping: the type system
> enforces this, comments don't.

**Booking transaction:**

```
BEGIN
  verify slot is still derivable from availability
  INSERT appointment (status=REQUESTED)   ← exclusion constraint arbitrates
  INSERT audit_log
  enqueue confirmation + reminder jobs
COMMIT
```

**State machine:**

```
REQUESTED ──confirm──> CONFIRMED ──complete──> COMPLETED
    │                      │
    └──cancel──> CANCELLED │
                           ├──cancel──> CANCELLED
                           └──no-show──> NO_SHOW
```

Whether `REQUESTED` auto-confirms is a per-doctor setting. Some want to vet every booking; some want a filled calendar.

**Reminders** run on a job queue — use `pg-boss` (Postgres-backed) rather than BullMQ, so you don't run Redis just for this. Reminder at T-24h and T-2h, via SMS, because in this market SMS lands and email doesn't.

---

## 7. Async chat

Not realtime. Don't reach for WebSockets.

- Threads scoped to a `PatientDoctorLink`. There is no way to address a message to someone you have no link with.
- **SSE for live updates on an open thread, polling as the fallback.** WebSockets add infrastructure you'd be maintaining for a feature where a 5-second delay is invisible.
- Per-doctor response SLA shown to the patient, so expectations are set.
- Attachments to private object storage, signed URLs, scanned on upload, MIME-sniffed rather than trusting the extension.
- **A hard, unmissable banner: this is not for emergencies.** Both in the UI and in the doctor's onboarding terms. This is a real clinical-safety and liability issue, not decoration.
- Message bodies are envelope-encrypted like notes.

---

## 8. Documents & prescriptions

- **The prescribing screen shows the patient's declared drug allergies inline**, before the doctor confirms (§3.1). An untouched field reads *"not recorded"*, never a blank that looks like "none." This is the whole reason the field exists — it has to be on the screen at the moment of prescribing, not buried in a profile tab.
- Server-side PDF generation (React-PDF or Puppeteer) from versioned templates, per-locale, with the doctor's letterhead and license number.
- **Immutable once issued.** A correction issues a new version pointing at `supersedesId`. Never edit a prescription in place — the paper trail is the point.
- Private bucket only. Access via signed URLs valid ~60 seconds, minted per request, **after** an authorization check. Never a public URL, never a guessable key.
- **Every single read is audited.** Document access is the highest-value target on the platform and the thing a regulator will ask about first.
- Checksum on write, verified on read.
- Digital signature: out of scope for v1, but leave the field. Several MENA markets are moving toward mandated e-prescription formats — worth a conversation with counsel before you're locked into a template.

---

## 9. i18n & RTL

Arabic RTL is the reason this is Phase 0 and not Phase 5. Retrofitting direction-awareness touches every component you've written.

- **`next-intl`** with `/[locale]/` routing. `fr` default, `ar` alongside.
- **Logical CSS properties everywhere.** `margin-inline-start`, never `margin-left`. `padding-inline`, `border-inline-end`, `text-align: start`. Tailwind supports `ms-*` / `me-*` / `ps-*` / `pe-*` — use them exclusively and add an ESLint rule banning the physical variants. This one discipline is most of RTL.
- `<html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>`.
- Icons with direction (arrows, chevrons, back buttons) need mirroring. Logos and clock icons don't.
- **Doctor-authored content is `Json` per locale** (`{ fr, ar }`), not a translation service. A doctor writes their own bio in each language they practice in.
- Numbers, dates, currency through `Intl`. Arabic-Indic vs Western numerals is a real preference question in this market — ask a few target users, don't guess.
- Fonts: a proper Arabic face (IBM Plex Sans Arabic, Noto Sans Arabic). Latin fonts rendering Arabic look broken to a native reader and will cost you credibility on first impression.
- **Test RTL from the first component.** A screenshot test in both directions on the design-system primitives catches ~90% of this at the cheapest possible moment.

---

## 10. Security & compliance

Designed to a GDPR-shaped baseline, which is the strictest common denominator and adapts downward to Tunisian INPDP / Moroccan CNDP / Algerian requirements.

### The one that constrains your infrastructure

**Health data cross-border transfer is restricted in most MENA jurisdictions.** Tunisia's INPDP requires prior authorization to transfer personal health data abroad; Morocco's CNDP has a similar regime. This is not a checkbox — it determines where the database physically lives, and it can rule out the default deployment path.

Practically: **Vercel's default multi-region setup is probably not compatible with hosting the database.** You have two options:

1. **Frontend on Vercel, data in an EU/local region** — Postgres in a fixed EU region (Neon/Supabase EU, or a Tunisian/Moroccan provider), object storage in the same region. Still a cross-border question depending on jurisdiction and on where Vercel's functions execute.
2. **Everything self-hosted in one jurisdiction** — a VPS in a local or EU datacenter, Docker Compose or a small Kubernetes setup. More ops work, unambiguous compliance story.

**Status: deferred by decision, 2026-07-16.** Not resolved — parked.

This is safe to park *if* we park it correctly, because the cost isn't in the code, it's in the data. An empty database moves for free. A database with six months of real patients in it moves under regulatory scrutiny, with a notification obligation and a lawyer on the clock.

So the deferral holds under two conditions:

1. **Nothing in the codebase assumes a host.** No Vercel-specific primitives (no `@vercel/*` runtime deps, no edge-runtime-only code paths), storage behind an S3-compatible interface, jobs in `pg-boss` rather than a hosted queue, plain Postgres with no provider extensions. The whole app must stay `docker compose up`-able on a VPS in any jurisdiction. This costs nothing now and preserves every option.
2. **The tripwire is the first real patient, not launch day.** Dev and staging on whatever is convenient, with seeded fake data. The moment one genuine patient row exists, the jurisdiction is decided and the answer is load-bearing.

Resolve before Phase 7. Needs local counsel in the target country — this is not a question engineering can answer.

### Everything else

- **Encryption at rest** on the database, plus **app-layer envelope encryption** for notes, messages, reason-for-visit, and allergies (§3.1). Keys in a KMS, per-record data keys. A stolen database dump is then still opaque. Note that data minimization *raises* the value of this rather than lowering it — everything we store is the sensitive part.
- **TLS 1.3**, HSTS, a real CSP, secure cookie flags.
- **Mandatory 2FA (TOTP) for `DOCTOR`, `DOCTOR_STAFF`, and all admin roles.** Optional for patients.
- **Sessions:** short-lived JWT access token + rotating refresh token in an httpOnly cookie. Server-side revocation list so suspending an account is immediate rather than eventual.
- **Rate limiting** on auth, booking, and messaging. Lockout with exponential backoff.
- **Audit log** append-only, ideally on a separate connection with `INSERT`-only grants, so application code physically cannot rewrite history.
- **Consent records** versioned — which ToS/privacy version, accepted when, from which IP.
- **Retention vs. erasure.** These conflict and you must decide explicitly: a patient's right to erasure runs against a doctor's legal duty to retain medical records (often 10–20 years). The usual resolution: erase the account and identifying profile, retain the clinical record under the doctor's legal obligation with a pseudonymized key. **Write this policy down before launch** — it's the question that gets asked in an audit and the one you cannot improvise.
- **License verification is a manual super-admin gate.** No doctor profile publishes without a human checking the license number. This is your liability firewall and it should never be automated away.
- **Doctor offboarding.** What happens to the records when a doctor leaves the platform? Patients keep documents; notes follow the doctor's legal retention duty. Decide before the first doctor asks.

---

## 11. Infrastructure

| Concern | Choice | Note |
|---|---|---|
| App | Next.js 15, App Router, RSC | One deploy for all three spaces |
| DB | PostgreSQL 16 + Prisma | Region fixed by Section 10 |
| Jobs | `pg-boss` | Postgres-backed; avoids running Redis |
| Storage | S3-compatible, same region | Private buckets, signed URLs only |
| Email | Postmark / Resend (EU) | Transactional only |
| SMS | Local aggregator | Primary channel for reminders in this market |
| Auth | Auth.js or Lucia | Credentials + TOTP |
| UI | Tailwind + shadcn/ui | Audit for logical properties |
| i18n | next-intl | |
| Errors | Sentry, **PII scrubbed** | Aggressive scrubbing — a stack trace with a patient name in it is a breach |
| CI | GitHub Actions | Already have `.github/` |

---

## 12. Delivery phases

> **Progress (2026-07-20, later):** Phases 0, 2, 3, 4a and 4b complete — 116
> unit + 62 end-to-end tests green, verified in a real browser (fr + ar/RTL).
> **4b (documents & prescriptions):** React-PDF generation (no browser binary,
> §10), S3-compatible storage behind an interface (MinIO in dev), immutable
> issuance + versioning + revocation, and — a deliberate override of §8 —
> **app-proxied audited downloads instead of signed URLs** (no leakable bearer;
> every read audited). The §3.1 allergy-safety screen is live: allergies shown
> at prescribing, issue gated on acknowledgment, an encrypted snapshot recorded
> at issuance; a patient allergy editor completes the loop. Remaining Phase 4:
> **4c, patient-initiated sharing** — the first deliberate hole in the §2
> boundary, its own spec. The calendar redesign (§12b) is still deferred.
>
> **Superseded note (2026-07-20):** Phases 0, 2, 3 and 4a complete — 97 unit +
> 43 end-to-end tests green. **Phase 4 was split into three sub-projects**
> (`docs/superpowers/specs/`): 4a consultation notes (done), 4b documents &
> prescriptions, 4c patient-initiated sharing. 4a ships an encrypted per-patient
> notes journal with immutable revision history and retract-not-delete; verified
> in-browser incl. the §5 staff block. Two smaller fixes landed alongside:
> signed-in users had no way back from public pages and no sign-out at all (the
> Phase-2 `revokeSession` was never wired to a control) — both fixed and
> browser-verified. **Deferred by user request:** the doctor calendar redesign
> (month view + Mois/Semaine toggle + detail drawer), recorded in §12b.
> Next: Phase 4b, documents & prescriptions.
>
> **Superseded note (2026-07-19):** Phases 0, 2 and 3 complete — 87 unit + 21
> end-to-end tests green. Phase 3 added the doctor week calendar and
> availability editor, custom-built (not FullCalendar) so RTL is correct by
> construction. Driving the UI caught two bugs no unit test could: doctors
> redirected into the patient space after login, and client components with no
> message catalogue.
>
> **Superseded note (2026-07-18):** Phases 0 and 2 complete — 53 tests green.
> Booking, cancellation, the confirm/decline vetting loop, and the notification
> pipeline (transactional outbox → pg-boss → SMS) are all in place, plus 2FA
> enrollment. Two caveats before this is live: the SMS provider is still a
> console stub (nothing is actually delivered), and `001_hardening.sql` must be
> applied or concurrent bookings can double-book. Next: Phase 3, the doctor
> calendar and availability editor.

**Phase 0 — Foundations (~1.5 weeks).** Repo, Prisma schema, migrations, Auth.js with TOTP, RBAC guard module + tests, i18n skeleton with fr/ar and RTL primitives, design system, CI. *Resolve the hosting jurisdiction question.*

**Phase 1 — Public surface (~1.5 weeks).** Landing page, doctor directory with search/filter, public profiles, SSR + metadata + sitemap, both locales.

**Phase 2 — Booking (~2.5 weeks).** Registration/login, `next`-param flow into the per-doctor space, availability engine, exclusion constraint, booking + cancellation, confirmations, SMS reminders via pg-boss.

**Phase 3 — Doctor space (~2.5 weeks).** Calendar (day/week), availability and exception editor, patient list scoped by link, appointment lifecycle, doctor profile editor, `DOCTOR_STAFF` role and its restrictions.

**Phase 4 — Clinical (~2.5 weeks).** Consultation notes with envelope encryption, document engine, PDF templates per locale, prescription issuance and versioning, patient document timeline, patient-initiated sharing, audit on every read.

**Phase 5 — Messaging (~1.5 weeks).** Threads, SSE + polling fallback, attachments, unread counts, SLA display, emergency banner.

**Phase 6 — Admin (~2 weeks).** Doctor onboarding queue, license verification, publish gate, user management, role assignment UI, audit log viewer, break-glass flow, platform settings.

**Phase 7 — Hardening (~2 weeks).** Pen test, RLS policies, load test on booking, full RTL sweep, retention/erasure implementation, DPA paperwork, runbooks, backup restore drill.

Roughly **16 weeks** for one full-time developer. Phases 1 and 3 parallelize if there are two of you.

---

## 12b. Calendar redesign — requested 2026-07-19

Reference screenshots supplied from an existing car-rental admin the user built.
Deferred by their instruction ("I'll check the calendar later") — recorded here
so the direction isn't lost.

**Wanted:**

1. **Month view as the default**, not week. A 6×7 day grid, leading/trailing
   days from adjacent months greyed, today's cell outlined.
2. **A Mois / Semaine segmented toggle** in the header, next to the prev/next
   arrows and an "Aujourd'hui" button. The week view already built becomes the
   secondary mode rather than the only one.
3. **A right-hand detail drawer** on clicking an appointment, rather than the
   current inert block: patient identity, appointment period, and the actions
   (Modifier / Démarrer / Annuler) pinned to the bottom.
4. **A status legend as coloured dots** above the grid, with filter chips
   ("Tous les statuts") and a search field.

**Notes for when this is built:**

- The `WeekGrid` layout maths (`layoutEvents`, `toPercent`) is view-agnostic and
  carries over; a month cell needs a *count* + overflow ("+3") rather than
  lane-packing, so it wants a separate small renderer, not a rewrite.
- The drawer must respect §5: it shows scheduling data only. Reason-for-visit is
  encrypted clinical text and does **not** belong in a calendar popover that a
  `DOCTOR_STAFF` can open.
- The drawer slides from the inline-end edge, so it must use
  `inset-inline-end` — in Arabic it belongs on the left.
- The reference uses green for confirmed; the current palette uses brand-blue
  for confirmed and amber for pending. Worth settling the status colours as a
  set (§ dataviz-style categorical palette) rather than per-component.

---

## 13. Open questions

**Resolved 2026-07-16:**
- ~~Health data scope~~ → minimal; reason-for-visit + notes + documents only. See §3.1.
- ~~Visibility~~ → patient and treating doctor only. Confirms the link boundary and the super-admin exclusion in §5.
- ~~Hosting jurisdiction~~ → **deferred**, with the host-agnostic constraint and the first-real-patient tripwire in §10.

**Resolved 2026-07-18:**
- ~~Drug allergies field~~ → **in**. One structured field, cross-doctor visible, shown on the prescribing screen, empty-state disambiguated. See §3.1 and §8.

**Resolved 2026-07-18 — delegated decisions.** All defaulted deliberately, each reversible without rearchitecting; revisit any with real user data.

1. **Cross-doctor sharing → keep the conservative model.** Private notes, patient-owned documents, no implicit cross-doctor record, allergies the one exception. Reversible later toward a shared record *if* the consent model is built to match; the reverse — walking back an over-shared record — is not. Start tight.

2. **Bookings → doctor-vetted by default, per-doctor toggle to auto-confirm.** New `REQUESTED` appointments wait for the doctor. A curated launch trades a filled calendar for the doctor keeping control of who lands in it, and it sidesteps the awkward v1 case of a booking the doctor can't honor. `DoctorProfile.autoConfirm: Boolean @default(false)` flips it per practice.

3. **Browsing → fully public, no account.** Landing, directory, and profiles are SSR and indexable (§4, Phase 1). Auth is required only at the moment of booking. This is the SEO engine; gating it behind login would kill discovery.

4. **No-show → tracked and surfaced, softly gated, never punished automatically.** With no payment to hold there's no financial teeth, and inventing some would be hostile in this market. So: record `NO_SHOW`, show the per-patient count to the doctor, and after a threshold (default 2 in 90 days) that patient's future bookings with *that* doctor silently switch to manual-confirm even if the doctor is on auto. Doctor-scoped, reversible, no platform-wide blacklist. A shared no-show reputation across doctors would breach the link boundary — explicitly out.

5. **Numerals → Western (0 1 2 3) default, locale-overridable.** Maghreb web usage is overwhelmingly Western digits even in Arabic text; Arabic-Indic is a Gulf/Egypt convention. Rendered through `Intl.NumberFormat`, so switching a locale to Arabic-Indic digits is a config line, not a rewrite. Confirm with target users before locking.

6. **Directory → plain Postgres, no search infrastructure.** Assuming a curated launch of tens of doctors, not thousands. Indexed filters on specialty/city plus a Postgres `tsvector` full-text column carries this comfortably into the hundreds. A dedicated search engine is a later conversation triggered by real scale, not a launch dependency.
