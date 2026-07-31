---
name: run-medic
description: Build, run, and drive the Medic app. Use when asked to start Medic, run the dev server, log in as a patient or doctor, book an appointment, run its tests or e2e, take a screenshot of the UI, or check a change in the real running app.
---

Medic is a Next.js 15 app (App Router, Postgres/Prisma, Auth.js + TOTP, fr/ar RTL).
Agents drive it with **`playwright-cli`** against a dev server. The whole
patient-books → doctor-confirms loop runs in one command:

```bash
bash .claude/skills/run-medic/smoke.sh
```

All paths are relative to the repo root. Windows + Git Bash; Postgres runs in Docker.

## Prerequisites

Node 24, Docker, and `@playwright/cli` (global, provides `playwright-cli`) are already
installed on this machine. Only the browser binary had to be fetched:

```bash
playwright-cli install-browser chrome-for-testing   # ~115 MB, one time
```

If `playwright-cli` is ever missing: `npm install -g @playwright/cli`.

`playwright-cli` defaults to **branded Chrome**, which is not installed here — always
pass `--browser chromium` on `open` (it resolves to chrome-for-testing).

## Setup

```bash
npm install
```

Postgres runs in a container named `medic-pg` on host port **55432** (not 5432):

```bash
docker start medic-pg 2>/dev/null || docker run -d --name medic-pg \
  -e POSTGRES_USER=medic -e POSTGRES_PASSWORD=medic -e POSTGRES_DB=medic \
  -p 55432:5432 postgres:16
```

Create `.env.local` (Next reads it automatically):

```bash
sed -e 's|^AUTH_SECRET=.*|AUTH_SECRET="'"$(openssl rand -base64 32)"'"|' \
    -e 's|^ENCRYPTION_MASTER_KEY=.*|ENCRYPTION_MASTER_KEY="'"$(openssl rand -base64 32)"'"|' \
    -e 's|localhost:5432/medic|localhost:55432/medic|' \
    .env.example > .env.local
```

**The Prisma CLI does not read `.env.local`** — it only auto-loads `.env`. Export
`DATABASE_URL` for every `prisma`/`tsx` command in this file:

```bash
export $(grep -E '^DATABASE_URL' .env.local | tr -d '"')
```

Then the schema:

```bash
npx prisma generate
npx prisma migrate deploy
docker exec -i medic-pg psql -U medic -d medic < prisma/sql/001_hardening.sql
```

The hardening SQL is **not idempotent** — on a DB that already has it you get
`ERROR: relation "appointment_no_overlap" already exists` and a few duplicate-policy
errors. Those are benign; the `CREATE EXTENSION`/`ALTER TABLE` lines still apply.
Without this file the exclusion constraint is missing and concurrent bookings
double-book (§3).

## Run (agent path)

Start the dev server, then run the smoke script:

```bash
npm run dev &                      # http://localhost:3000 → /fr
export $(grep -E '^DATABASE_URL' .env.local | tr -d '"')
bash .claude/skills/run-medic/smoke.sh
```

It seeds login-capable fixtures, logs in as the patient, books a 09:00 slot, logs in
as the doctor through the two-step TOTP form, confirms the request, and asserts
`CONFIRMED` + scheduled reminders in Postgres. Output ends in `SMOKE PASS`.

Screenshots land in the directory you pass (default `./.playwright-cli/shots/`):
`1-patient-dash.png`, `2-booked.png`, `3-doctor-dash.png`, `4-confirmed.png`.

### Fixtures

`scripts/e2e-booking.ts` creates users with **no `passwordHash`** — nothing it makes
can log in. `fixtures.ts` is the browser-drivable counterpart, and unlike the e2e
script it upserts instead of truncating:

```bash
npx tsx .claude/skills/run-medic/fixtures.ts seed   # create/refresh + print creds
npx tsx .claude/skills/run-medic/fixtures.ts totp   # current doctor 2FA code
npx tsx .claude/skills/run-medic/fixtures.ts show   # creds + doctorId/clinicId
```

| account | credentials | 2FA |
|---|---|---|
| patient | `patient.ui@medic.test` / `correct-horse-battery-staple` | none (patients are exempt, §10) |
| doctor | `doctor.ui@medic.test` / `correct-horse-battery-staple` | required — secret is fixed, use `fixtures.ts totp` |

### Driving it by hand

```bash
playwright-cli open --browser chromium http://localhost:3000/fr
playwright-cli goto http://localhost:3000/fr/login
playwright-cli fill 'input#email' patient.ui@medic.test
playwright-cli fill 'input#password' correct-horse-battery-staple
playwright-cli click 'button[type=submit]'          # → /fr/p
playwright-cli snapshot                              # accessibility tree
playwright-cli screenshot --filename ./shot.png
playwright-cli eval "() => location.pathname" --raw
```

Booking page is `/fr/p/doctors/<doctorId>/book` — keyed by **doctorId**, while the
public profile is `/fr/doctors/<slug>`. Get the id from `fixtures.ts show`.

## Run (human path)

```bash
npm run dev       # → http://localhost:3000, redirects to /fr. Ctrl-C to stop.
npm run worker    # drains the outbox → pg-boss → console SMS adapter. Runs forever.
```

The worker prints `[sms] ***001 93 chars` lines — `getNotifier()` is a console stub,
so nothing is actually delivered.

## Test

```bash
npm test          # 87 pass — pure logic, no DB needed (count grows as phases land)
npm run typecheck # clean
npm run lint      # clean (warns that `next lint` is deprecated)

export $(grep -E '^(DATABASE_URL|ENCRYPTION_MASTER_KEY)' .env.local | tr -d '"')
npx tsx scripts/e2e-booking.ts   # 21 pass — domain layer against real Postgres
```

`e2e-booking.ts` prints a scary `ConnectorError ... exclusion constraint` stack
mid-run. That is the deliberate double-booking race being rejected — the test
asserts it. Look at the final `21 passed, 0 failed`, not the stack.

## Gotchas

- **`scripts/e2e-booking.ts` truncates every table**, including the UI fixtures, and
  the re-seeded doctor gets a **new `doctorId`**. Re-run `fixtures.ts seed` after it
  and re-read the id — never hardcode a booking URL. `smoke.sh` parses it each run.
- **`npm run build` wipes the dev server's `.next`**, and the running `next dev`
  starts serving 404s without exiting. It keeps holding port 3000, so a new
  `npm run dev` silently binds **3001** while everything pointed at 3000 fails. Kill
  the stale process and `rm -rf .next` before restarting (see Troubleshooting).
- **`ref=e42` targets from `playwright-cli snapshot` silently do nothing** on this
  app — the click reports success and the page never changes. Use CSS/text
  selectors: `'button:has-text("09:00") >> nth=0'`.
- **The doctor login form clears the password field** when it re-renders with the
  TOTP input. Step two must re-fill email *and* password alongside the code, or it
  fails as a plain bad-credentials attempt.
- **The "Confirmer le rendez-vous" button is `[disabled]` until a slot is clicked.**
  If a click didn't register you get a silent no-op, not an error.
- **`playwright-cli` writes snapshots and console logs into `./.playwright-cli/`** in
  the repo. Added to `.gitignore`.
- The doctor's `mfaSecret` is stored as **plaintext base32** (not envelope-encrypted),
  which is why a fixed secret in `fixtures.ts` produces valid codes.

## Troubleshooting

- **`Error: P1012 Environment variable not found: DATABASE_URL`** — Prisma CLI
  ignores `.env.local`. Export it first (see Setup).
- **`P1001: Can't reach database server at localhost:5432`** — the container maps
  **55432**. Check with `docker ps --filter name=medic-pg --format '{{.Ports}}'`.
- **`Chromium distribution 'chrome' is not found`** — pass `--browser chromium`, and
  run `playwright-cli install-browser chrome-for-testing` once.
- **`Browser "chrome-for-testing" is not installed`** — same fix, run the installer.
- **`SMOKE FAIL: no dev server on http://localhost:3000`** while `npm run dev` seems
  to be running — it's on 3001 because a zombie holds 3000:
  ```bash
  # PowerShell
  Get-NetTCPConnection -LocalPort 3000,3001 -State Listen | Select LocalPort,OwningProcess
  taskkill /PID <pid> /T /F
  ```
  Then `rm -rf .next && npm run dev`.
- **`IntlError: MISSING_MESSAGE: No messages were configured on the provider`**, with
  buttons rendering raw keys like `common.login` instead of translated text. This is
  **not** a bug in the i18n setup — `[locale]/layout.tsx` passes messages correctly.
  It means the client bundle is broken and the provider hydrated empty, which comes
  from a degraded dev server (see the `npm install` entry below). Restart the server
  clean and it disappears. Don't go hunting in `src/i18n/`.
- **`Refused to execute script ... /_next/static/chunks/fallback/webpack.js` (MIME
  `text/plain`) plus a wall of 404s on `fallback/*.js`** — the dev server's chunks
  are gone, usually because `npm install` ran while it was up. Every client component
  silently stops hydrating. Kill it, `rm -rf .next`, restart.
- **Login says `Identifiants invalides.` with credentials you know are right** —
  check the database is actually up (`docker ps --filter name=medic-pg`). The login
  path deliberately collapses *every* failure into one generic message to avoid an
  account-enumeration oracle (§10), so a stopped Postgres container is indistinguishable
  from a wrong password. `docker start medic-pg`, then re-seed if fixtures are missing.
- **`favicon.ico 404`** in the console on every page. Harmless, no favicon exists.
- **`npm warn allow-scripts ... prisma@6.19.3 (install scripts present)`** — npm 11
  blocks postinstall scripts by default. Harmless here: `npx prisma generate` fetches
  the engines itself, and the whole flow above works without approving anything.
