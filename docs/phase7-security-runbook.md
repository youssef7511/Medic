# Phase 7 security runbook

This runbook covers the production activation of KMS, real SMS, hardened MFA
enrollment and break-glass. It does not replace the jurisdiction, DPA,
retention, or incident-notification decisions that require local counsel.

## 1. Pre-deployment gates

1. Decide the database, object-storage, application and log regions before the
   first real patient row (§10). Keep them in the approved jurisdiction.
2. Run `npm ci`, `npx prisma generate`, `npm run typecheck`, `npm test`, and
   `npm run build` against the release commit.
3. Apply `20260918000000_phase7_hardening` before deploying application code.
4. Confirm the application DB role cannot `UPDATE` or `DELETE` `AuditLog`.
5. Confirm TLS termination only accepts TLS 1.2/1.3 and preserves the client IP
   through a trusted `X-Forwarded-For` chain.

## 2. AWS KMS activation

Create a symmetric KMS key in the same approved region as the database. Give
the application role only `kms:Encrypt` and `kms:Decrypt` on that key. The
adapter always supplies this encryption context:

```text
application=medic
purpose=clinical-envelope-encryption
```

Constrain the IAM/key policy to that context and enable automatic key rotation.
Set:

```dotenv
KMS_PROVIDER=aws
KMS_KEY_ID=alias/medic-clinical
AWS_REGION=<approved-region>
```

### Rolling migration from v1

Keep the old `ENCRYPTION_MASTER_KEY` temporarily so v1 rows remain readable.
Deploy the v2-capable code first, take a verified backup, then run:

```bash
CONFIRM_KMS_REWRAP=phase7 npm run crypto:rewrap
```

The job is restartable and updates only v1 blobs. Verify that it reports zero
rows on a second run. Exercise notes, messages, allergies and prescription
downloads before removing `ENCRYPTION_MASTER_KEY` in a later deployment. Never
remove the legacy key before backup restore and data-read verification.

## 3. Real SMS delivery

Choose one provider mode:

- `SMS_PROVIDER=twilio` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and an
  E.164 `TWILIO_FROM_NUMBER`; or
- `SMS_PROVIDER=http` with `SMS_HTTP_ENDPOINT`, `SMS_PROVIDER_API_KEY` and
  `SMS_SENDER` for the regional aggregator JSON contract.

`console` is rejected in production. Send staging messages to approved test
numbers, then verify booking confirmation, T-24h, T-2h, cancellation and
break-glass notification. Alert on pg-boss exhausted retries and growing
`OutboxMessage` rows. Logs must contain neither message bodies nor full phone
numbers.

## 4. Privileged MFA enrollment

1. Assign the doctor/staff/admin role.
2. In **Admin → Utilisateurs**, issue a **Jeton MFA**.
3. Copy it once and hand it to the user out-of-band. Do not send it in the same
   channel as their password.
4. The user enters email, password and token at `/fr/enroll-mfa`, scans the QR,
   and proves possession with a TOTP code.

The token expires after 30 minutes, is stored only as a SHA-256 digest, and is
consumed atomically when enrollment completes. Issuing a replacement revokes
every previous unused token and clears abandoned pending enrollment state.

## 5. Break-glass procedure

Use break-glass only when ordinary doctor/patient access cannot resolve an
urgent support or safety incident.

1. A SUPER_ADMIN opens **Admin → Break-glass**.
2. Enter the exact patient ID/e-mail, a substantive 20–500 character reason,
   a 5/15/30-minute duration, and a fresh MFA code.
3. Activation and the patient-notification outbox event commit together.
4. Every snapshot read writes a patient-indexed critical audit event. If audit
   storage fails, access fails closed.
5. Revoke access immediately when the task ends. Expiry is checked on every
   read; a grant cannot be extended in place.
6. The security owner reviews `break_glass.*` audit events and confirms SMS
   delivery during the incident review.

SUPER_ADMIN still has no standing `note:read` or clinical-message permission.

## 6. Backup restore drill

At least quarterly, restore the newest database backup and object-storage
snapshot into an isolated account/region approved for test data. Use a copied
KMS grant scoped to the restored environment. Verify:

- schema migrations and row counts;
- one v2 note/message/allergy decrypt per fixture patient;
- document checksum and PDF download;
- audit continuity and append-only grants;
- login, MFA, session revocation and one outbox dispatch with a fake SMS target.

Record RPO, RTO, backup timestamp, restore duration, verifier, exceptions and
follow-up owner. Destroy the isolated restore after the drill under the agreed
retention policy.
