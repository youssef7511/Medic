# Medic messaging E2EE

Chosen rollout: keep historical server-encrypted messages readable, explicitly labelled,
and require browser encryption for every new chat message. Existing clinical documents
and uploads retain their separate document encryption/access model; they are not E2EE.

OpenPGP.js implements the standard message format. Each account registers one immutable
public certificate. Its private certificate is protected by a separate messaging
passphrase and stored encrypted in IndexedDB. Users download that protected certificate
as a recovery file. Unlocked keys live only in browser memory. Neither the private
certificate, passphrase nor recovery secret is sent to an application endpoint.
An additional browser imports the same file and supplies the messaging passphrase.
Without both, access cannot be restored by password reset or an administrator. Identity
rotation/device-specific revocation are not part of this initial account-key version.

Messages are signed by their sender, encrypted for both participants, and bind the
thread, message ID, sender and recipient inside the signed encrypted payload. Clients
verify signatures and context before displaying plaintext. Server handlers only route
ciphertext after link/session authorization; old plaintext server actions reject sends.
Encrypted messages never appear as plaintext in SSR/RSC, event streams, subjects,
server previews, logs or audit metadata. Legacy history remains server readable. Emergency/break-glass snapshots return no
E2EE plaintext and continue to handle legacy history; there is no administrative key escrow.

Users compare fingerprints over an independent trusted channel and explicitly pin the
peer fingerprint locally before sending. A different peer certificate blocks sending.
Initial identity authenticity still depends on actually comparing fingerprints; server
registration alone does not establish it. The existing web trust model also remains:
malicious JavaScript served by a compromised origin or XSS can steal unlocked content.
HTTPS and the current strict CSP are required for deployment.

OpenPGP account keys do not provide Signal-style forward secrecy or post-compromise
security. This implementation must not be described as Signal or independently audited.
If those properties, independent device keys or key transparency become requirements,
choose a supported protocol implementation and design its lifecycle before rollout.

Verification must exercise distinct patient/doctor browser contexts, server ciphertext,
no plaintext POSTs/SSR/event payloads, recovery in a clean browser, wrong-key/signature
failure, context/replay isolation, nonparticipant/staff denial and legacy labels.

## Local rollout and verification

1. Apply `npx prisma migrate deploy` with the app database configuration.
2. Stop old app instances so they cannot accept legacy plaintext submissions.
3. Run `npm run e2ee:protect-subjects` with the existing clinical encryption keys.
4. Start the updated app. Keep HTTPS enabled outside localhost.
5. Both participants activate messaging, save recovery files and compare fingerprints.

The database migration labels existing messages `server-v1`; it never rewrites
historical bodies as E2EE. The subject-protection command is restartable and
preserves subjects under the existing clinical envelope encryption.

`npm run e2e:messaging` requires a running local app, Postgres and Playwright
Chromium. `BASE_URL` selects the local app (default port 3100);
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects an installed browser. Fixtures
are fictional and uniquely named; the script deletes only its own database rows.
Downloaded test recovery files contain protected fixture keys, not clinical data.

A signed delivery proof binds ciphertext to its message ID, thread and both
participants before the server accepts it. Exact packet retries are idempotent.
Read receipts are sent after a browser verifies/decrypts a received E2EE message;
legacy receipts follow display of the existing server-encrypted history.

The browser automatically locks after 15 minutes without interaction. Locking
clears unlocked keys, drafts and decrypted message caches. Users must unlock again
after navigation/reload. Saved peer fingerprints and protected recovery material
remain account-scoped in IndexedDB; plaintext messages are never persisted there.
