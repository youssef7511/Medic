#!/usr/bin/env bash
# Drives the full Medic booking loop through a real browser:
#   seed fixtures -> patient logs in -> books a slot -> doctor logs in (TOTP)
#   -> doctor confirms -> assert CONFIRMED in the DB.
#
# Everything here is playwright-cli against a dev server you started yourself.
# Run from the repo root:
#
#   bash .claude/skills/run-medic/smoke.sh [screenshot-dir]
#
# Requires: dev server on :3000, medic-pg container up, DATABASE_URL exported.

set -uo pipefail

SHOTS="${1:-./.playwright-cli/shots}"
BASE="http://localhost:3000"
PW="playwright-cli"
# Branded Chrome is usually absent; chrome-for-testing is what we installed.
BROWSER="--browser chromium"
EMAIL_P="patient.ui@medic.test"
EMAIL_D="doctor.ui@medic.test"
PASS="correct-horse-battery-staple"
FIX=".claude/skills/run-medic/fixtures.ts"

mkdir -p "$SHOTS"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL not exported (see SKILL.md)"
curl -sf -o /dev/null "$BASE/fr" || fail "no dev server on $BASE — run 'npm run dev' first"

# --------------------------------------------------------------- fixtures
step "seeding UI fixtures"
SEED_OUT=$(npx tsx "$FIX" seed 2>&1) || fail "fixture seed failed:\n$SEED_OUT"
echo "$SEED_OUT"
# doctorId is regenerated whenever scripts/e2e-booking.ts has truncated the DB,
# so always read it back rather than hardcoding it.
DOCTOR_ID=$(echo "$SEED_OUT" | sed -n 's/.*doctorId=\([a-z0-9]*\).*/\1/p')
[ -n "$DOCTOR_ID" ] || fail "could not parse doctorId from fixture output"
echo "doctorId=$DOCTOR_ID"

# ------------------------------------------------------------ patient login
step "patient login"
$PW open $BROWSER "$BASE/fr/login" >/dev/null 2>&1 || $PW goto "$BASE/fr/login" >/dev/null
$PW cookie-clear >/dev/null
$PW goto "$BASE/fr/login" >/dev/null
$PW fill 'input#email' "$EMAIL_P" >/dev/null
$PW fill 'input#password' "$PASS" >/dev/null
$PW click 'button[type=submit]' >/dev/null
sleep 2
URL=$($PW eval "() => location.pathname" --raw 2>/dev/null | tr -d '"')
echo "landed on: $URL"
case "$URL" in *"/p"*) ;; *) fail "patient login did not reach /p (got $URL)";; esac
$PW screenshot --filename "$SHOTS/1-patient-dash.png" >/dev/null

# ----------------------------------------------------------------- booking
step "booking a slot"
$PW goto "$BASE/fr/p/doctors/$DOCTOR_ID/book" >/dev/null
sleep 1
# The confirm button stays disabled until a slot is chosen. Note: `ref=` targets
# from `snapshot` do NOT work here — use CSS/text selectors.
$PW click 'button:has-text("09:00") >> nth=0' >/dev/null || fail "no 09:00 slot offered"
$PW fill 'textarea' 'Toux persistante depuis une semaine' >/dev/null
$PW click 'button:has-text("Confirmer le rendez-vous")' >/dev/null
sleep 3
BODY=$($PW eval "() => document.body.innerText" --raw 2>/dev/null)
echo "$BODY" | grep -q "Demande de rendez-vous envoyée" \
  || fail "booking confirmation text not found. Body was:\n$BODY"
$PW screenshot --filename "$SHOTS/2-booked.png" >/dev/null
echo "booking submitted"

# ------------------------------------------------------- doctor login (TOTP)
step "doctor login (2FA)"
$PW cookie-clear >/dev/null
$PW goto "$BASE/fr/login" >/dev/null
$PW fill 'input#email' "$EMAIL_D" >/dev/null
$PW fill 'input#password' "$PASS" >/dev/null
$PW click 'button[type=submit]' >/dev/null
sleep 2
# Step 2. The server clears the password field when it re-renders with the TOTP
# input, so email AND password must be re-filled alongside the code.
CODE=$(npx tsx "$FIX" totp 2>/dev/null | tr -d '\r\n ')
[ -n "$CODE" ] || fail "could not generate TOTP"
echo "totp=$CODE"
$PW fill 'input#email' "$EMAIL_D" >/dev/null
$PW fill 'input#password' "$PASS" >/dev/null
$PW fill 'input#totp' "$CODE" >/dev/null || fail "TOTP field never appeared — password step failed"
$PW click 'button[type=submit]' >/dev/null
sleep 3

step "doctor confirms the request"
$PW goto "$BASE/fr/d" >/dev/null
sleep 1
DOC=$($PW eval "() => document.body.innerText" --raw 2>/dev/null)
echo "$DOC" | grep -q "Amina Demo" || fail "doctor does not see the request. Body:\n$DOC"
$PW screenshot --filename "$SHOTS/3-doctor-dash.png" >/dev/null
$PW click 'button:has-text("Confirmer")' >/dev/null
sleep 3
$PW screenshot --filename "$SHOTS/4-confirmed.png" >/dev/null

# ------------------------------------------------------------------ assert
step "verifying in Postgres"
STATUS=$(docker exec medic-pg psql -U medic -d medic -tc \
  "SELECT status FROM \"Appointment\" ORDER BY \"createdAt\" DESC LIMIT 1;" | tr -d ' \r\n')
[ "$STATUS" = "CONFIRMED" ] || fail "expected CONFIRMED, got '$STATUS'"

REM=$(docker exec medic-pg psql -U medic -d medic -tc \
  "SELECT COUNT(*) FROM \"OutboxMessage\" WHERE topic='appointment.reminder';" | tr -d ' \r\n')
[ "$REM" -gt 0 ] || fail "no reminders scheduled after confirmation"

echo
echo "SMOKE PASS — appointment CONFIRMED, $REM reminder(s) scheduled."
echo "screenshots: $SHOTS"
