/** Real-browser E2EE regression. Unique fictional fixtures; deletes only its own rows. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { authenticator } from 'otplib';
import { hash } from 'bcryptjs';
import { PrismaClient, Role, ScopeType, Sex } from '@prisma/client';
import { encryptText } from '../src/lib/crypto/envelope';
import { getBreakGlassSnapshot } from '../src/lib/break-glass/access';
import { createIdentity } from '../src/lib/messaging/e2ee-crypto';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) throw new Error('Use a local test app.');
const db = new PrismaClient(); const stamp = Date.now();
const password = randomBytes(18).toString('hex');
const messagingSecret = randomBytes(24).toString('hex');
const secret = authenticator.generateSecret();
const users: string[] = []; const patientIds: string[] = []; const doctorIds: string[] = [];
let specialtyId: string | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let passed = 0;
const errors: string[] = []; const outbound: string[] = [];
function check(label: string, condition: boolean) { assert.ok(condition, label); passed++; console.log(`PASS ${label}`); }
async function mkUser(tag: string, role: Role, scopeId?: string) {
  const user = await db.user.create({ data: { email: `e2ee-${tag}-${stamp}@e2e.test`, passwordHash: await hash(password, 10), ...(([Role.DOCTOR, Role.DOCTOR_STAFF] as Role[]).includes(role) ? { mfaSecret: secret } : {}) } });
  users.push(user.id);
  await db.roleAssignment.create({ data: { userId: user.id, role, scopeType: scopeId ? ScopeType.DOCTOR : ScopeType.GLOBAL, scopeId, grantedBy: 'e2ee-test' } });
  return user;
}
async function mkPatient(tag: string) {
  const user = await mkUser(tag, Role.PATIENT);
  const profile = await db.patientProfile.create({ data: { userId: user.id, firstName: 'Patient', lastName: tag, dateOfBirth: new Date('1990-01-01'), sex: Sex.MALE, phone: '' } });
  patientIds.push(profile.id); return { user, profile };
}
async function login(page: Page, email: string, role: 'patient' | 'doctor') {
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/messages')) outbound.push(request.postData() ?? ''); });
  await page.goto(`${BASE}/fr/login/${role}`, { waitUntil: 'networkidle' });
  await page.locator('#email').fill(email); await page.locator('#password').fill(password);
  await page.locator('button[type=submit]').click();
  if (role === 'doctor') { await page.locator('#totp').waitFor({ timeout: 30000 }); await page.locator('#totp').fill(authenticator.generate(secret)); await page.locator('button[type=submit]').click(); }
  await page.waitForURL(/\/fr\/(p|d)(\/|$)/, { timeout: 30000 });
}
async function activate(page: Page, tag: string) {
  await page.getByTestId('messaging-passphrase').fill(messagingSecret);
  await page.getByTestId('messaging-passphrase-repeat').fill(messagingSecret);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Activer et télécharger mon fichier de récupération', exact: true }).click();
  const file = `.playwright-cli/e2ee-${tag}-${stamp}.json`; await (await downloaded).saveAs(file);
  await page.getByRole('button', { name: 'Verrouiller', exact: true }).waitFor({ timeout: 30000 });
  await page.getByTestId('recovery-saved').click();
  await page.getByTestId('recovery-saved').waitFor({ state: 'hidden' });
  return file;
}
async function trust(page: Page) {
  await page.getByTestId('fingerprints-compared').check();
  await page.getByRole('button', { name: 'Confirmer les empreintes', exact: true }).click();
  await page.getByText('Identité vérifiée sur cet appareil.', { exact: true }).waitFor({ state: 'attached' });
}
async function send(page: Page, text: string, threadId: string) {
  await page.getByTestId('secure-message-body').fill(text);
  const sent = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/messages/conversations/${threadId}`);
  await page.getByRole('button', { name: 'Envoyer le message chiffré', exact: true }).click();
  const response = await sent;
  if (response.status() !== 201) throw new Error(`Encrypted send failed with ${response.status()}`);
  return { message: { id: response.headers()['x-message-id'] }, packet: response.request().postDataJSON() };
}
async function main() {
  mkdirSync('.playwright-cli', { recursive: true });
  const specialty = await db.specialty.create({ data: { slug: `e2ee-${stamp}`, name: { fr: 'Test E2EE', ar: 'اختبار' } } }); specialtyId = specialty.id;
  const doctorUser = await mkUser('doctor', Role.DOCTOR);
  const doctor = await db.doctorProfile.create({ data: { userId: doctorUser.id, specialtyId, slug: `e2ee-${stamp}`, licenseNumber: 'FICTIONAL', headline: { fr: 'Dr E2EE Test', ar: 'طبيب الاختبار' }, bio: {}, languages: ['fr'], isPublished: true } }); doctorIds.push(doctor.id);
  const patient = await mkPatient('owner'); const outsider = await mkPatient('outsider'); const staff = await mkUser('staff', Role.DOCTOR_STAFF, doctor.id);
  const link = await db.patientDoctorLink.create({ data: { patientId: patient.profile.id, doctorId: doctor.id, status: 'ACTIVE', source: 'BOOKING' } });
  const thread = await db.messageThread.create({ data: { linkId: link.id, subjectEnc: await encryptText('Protected historical subject') } });
  const legacy = 'Ancien message conservé pour le test';
  await db.message.create({ data: { threadId: thread.id, senderUserId: patient.user.id, bodyEnc: await encryptText(legacy) } });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const patientContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await patientContext.newPage(); await login(page, patient.user.email!, 'patient');
  await page.goto(`${BASE}/fr/p/doctors/${doctor.id}/messages`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ouvrir la conversation chiffrée', exact: true }).click();
  await page.waitForURL(`**/messages/${thread.id}`);
  await page.getByText(legacy, { exact: true }).waitFor();
  check('legacy history remains readable with an explicit non-E2EE label', await page.getByText('Historique — chiffrement serveur, sans E2EE', { exact: true }).count() === 1);
  check('new messages are blocked before key activation', await page.getByTestId('secure-message-body').isDisabled());
  const patientFile = await activate(page, 'patient');
  check('recovery download contains only a password-protected private certificate', !(await (await import('openpgp')).readPrivateKey({ armoredKey: JSON.parse(readFileSync(patientFile, 'utf8')).privateKey })).isDecrypted());
  check('sending remains blocked while the doctor has no key', await page.getByTestId('secure-message-body').isDisabled());
  const doctorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const doctorPage = await doctorContext.newPage(); await login(doctorPage, doctorUser.email!, 'doctor');
  await doctorPage.goto(`${BASE}/fr/d/threads/${thread.id}`, { waitUntil: 'networkidle' });
  await activate(doctorPage, 'doctor');
  await page.getByTestId('fingerprints-compared').waitFor({ timeout: 20000 });
  check('both browsers independently display matching participant fingerprints', await page.getByTestId('peer-fingerprint').textContent() === await doctorPage.getByTestId('self-fingerprint').textContent() && await page.getByTestId('self-fingerprint').textContent() === await doctorPage.getByTestId('peer-fingerprint').textContent());
  await trust(page); await trust(doctorPage);
  const marker = `Résultat privé ${stamp} — تحليل خاص`;
  const reply = `Réponse privée ${stamp} — رد الطبيب`;
  const sent = await send(page, marker, thread.id);
  try { await doctorPage.getByText(marker, { exact: true }).waitFor({ timeout: 20000 }); } catch (error) { console.log('Recipient UI:', await doctorPage.locator('main').innerText()); throw error; }
  check('doctor decrypts and verifies the patient message in a separate browser', true);
  await page.locator(`[data-message-id="${sent.message.id}"]`).getByText(/· Lu/).waitFor({ timeout: 20000 });
  const row = await db.message.findUniqueOrThrow({ where: { id: sent.message.id } });
  check('verified message receipt is recorded and shown to the sender', row.readAt !== null);
  check('database stores only OpenPGP ciphertext for new messages', row.encryption === 'openpgp-v1' && Buffer.from(row.bodyEnc).toString().startsWith('-----BEGIN PGP MESSAGE-----') && !Buffer.from(row.bodyEnc).toString().includes(marker));
  check('conversation subjects never copy the new plaintext', (await db.messageThread.findUniqueOrThrow({ where: { id: thread.id } })).subject === null);
  const json = await patientContext.request.get(`${BASE}/api/messages/conversations/${thread.id}`);
  check('API serves ciphertext for new content and explicitly identifies legacy content', !(await json.text()).includes(marker) && (await json.text()).includes(legacy));
  const etag = json.headers()['etag']; assert.ok(etag);
  const unchanged = await patientContext.request.get(`${BASE}/api/messages/conversations/${thread.id}`, { headers: { 'If-None-Match': etag } });
  check('unchanged history polls return no message bodies', unchanged.status() === 304 && (await unchanged.body()).length === 0);
  const html = await patientContext.request.get(page.url());
  check('server-rendered HTML contains no new message plaintext', !(await html.text()).includes(marker));
  const stream = await patientContext.request.get(`${BASE}/api/messages/stream?threadId=${thread.id}`);
  check('event streams contain neither new nor old message bodies', !(await stream.text()).includes(marker) && !(await stream.text()).includes(legacy));
  const inbox = await doctorContext.request.get(`${BASE}/fr/d/threads`);
  check('server inbox previews never decrypt E2EE messages', !(await inbox.text()).includes(marker));
  await send(doctorPage, reply, thread.id);
  await page.getByText(reply, { exact: true }).waitFor({ timeout: 20000 });
  check('patient decrypts and verifies the doctor reply', true);
  await page.getByRole('button', { name: 'Verrouiller', exact: true }).click();
  check('locking removes decrypted new messages from the document', await page.getByText(marker, { exact: true }).count() === 0 && await page.getByText(reply, { exact: true }).count() === 0);
  check('locking preserves readable legacy history', await page.getByText(legacy, { exact: true }).count() === 1);
  const recoveredContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const recovered = await recoveredContext.newPage(); await login(recovered, patient.user.email!, 'patient');
  await recovered.goto(`${BASE}/fr/p/doctors/${doctor.id}/messages/${thread.id}`, { waitUntil: 'networkidle' });
  await recovered.getByTestId('messaging-passphrase').fill('incorrect-recovery-passphrase');
  await recovered.getByTestId('messaging-recovery-file').setInputFiles(patientFile);
  await recovered.getByRole('alert').waitFor();
  check('a wrong recovery phrase never unlocks conversation content', await recovered.getByTestId('secure-message-body').isDisabled() && await recovered.getByText(marker, { exact: true }).count() === 0);
  await recovered.getByTestId('messaging-passphrase').fill(messagingSecret);
  await recovered.getByTestId('messaging-recovery-file').setInputFiles(patientFile);
  await recovered.getByRole('button', { name: 'Verrouiller', exact: true }).waitFor();
  check('a restored browser requires its own identity verification', await recovered.getByText(marker, { exact: true }).count() === 0);
  await trust(recovered);
  await recovered.getByText(marker, { exact: true }).waitFor(); await recovered.getByText(reply, { exact: true }).waitFor();
  check('protected recovery file restores both sent and received messages on a clean browser', true);
  const retry = await patientContext.request.post(`${BASE}/api/messages/conversations/${thread.id}`, { headers: { Origin: BASE }, data: sent.packet });
  check('a retry is idempotent and does not create another message', retry.status() === 201 && await db.message.count({ where: { id: sent.message.id } }) === 1);
  const second = await db.messageThread.create({ data: { linkId: link.id } });
  const replay = await patientContext.request.post(`${BASE}/api/messages/conversations/${second.id}`, { headers: { Origin: BASE }, data: { ...sent.packet, id: randomUUID() } });
  check('delivery signatures reject cross-thread replay before storage', replay.status() === 400 && await db.message.count({ where: { threadId: second.id } }) === 0);
  const plaintext = await patientContext.request.post(`${BASE}/api/messages/conversations/${thread.id}`, { headers: { Origin: BASE }, data: { body: 'plaintext submission rejected' } });
  check('new plaintext API submissions are rejected', plaintext.status() === 400);
  const replacement = await createIdentity(patient.user.id, messagingSecret);
  const replace = await patientContext.request.post(`${BASE}/api/messages/identity`, { headers: { Origin: BASE }, data: { publicKey: replacement.bundle.publicKey, proof: replacement.proof } });
  check('registered identities cannot be silently replaced', replace.status() === 409);
  const admin = await mkUser('admin', Role.SUPER_ADMIN);
  const grant = await db.breakGlassGrant.create({ data: { actorUserId: admin.id, patientId: patient.profile.id, reason: 'Fictional E2EE access-isolation integration test', expiresAt: new Date(Date.now() + 5 * 60 * 1000) } });
  const snapshot = await getBreakGlassSnapshot({ userId: admin.id, roles: await db.roleAssignment.findMany({ where: { userId: admin.id } }) }, grant.id);
  const adminMessages = snapshot.links.flatMap(item => item.threads.flatMap(item => item.messages));
  check('emergency admin access cannot decrypt E2EE content and still handles old history', adminMessages.filter(message => message.encryption === 'openpgp-v1').every(message => message.body === null) && adminMessages.some(message => message.body === legacy));
  const strangerContext = await browser.newContext(); const stranger = await strangerContext.newPage(); await login(stranger, outsider.user.email!, 'patient');
  check('another patient cannot fetch conversation content or participant keys', (await strangerContext.request.get(`${BASE}/api/messages/conversations/${thread.id}`)).status() === 404);
  const denied = await strangerContext.request.post(`${BASE}/api/messages/conversations/${thread.id}`, { headers: { Origin: BASE }, data: sent.packet });
  check('another patient cannot submit ciphertext to the thread', denied.status() === 404);
  const staffContext = await browser.newContext(); const staffPage = await staffContext.newPage(); await login(staffPage, staff.email!, 'doctor');
  check('doctor staff cannot fetch clinical conversations or register messaging keys', (await staffContext.request.get(`${BASE}/api/messages/conversations/${thread.id}`)).status() === 404 && (await staffContext.request.get(`${BASE}/api/messages/identity`)).status() === 404);
  const csrf = await patientContext.request.post(`${BASE}/api/messages/identity`, { headers: { Origin: 'https://other.example' }, data: {} });
  check('cross-origin key registration is rejected', csrf.status() === 403);
  check('browser POSTs never send plaintext messages, private certificates or messaging secrets', outbound.every(body => !body.includes(marker) && !body.includes(reply) && !body.includes(messagingSecret) && !body.includes('BEGIN PGP PRIVATE KEY BLOCK')));
  await recovered.goto(`${BASE}/ar/p/doctors/${doctor.id}/messages/${thread.id}`, { waitUntil: 'networkidle' });
  await recovered.setViewportSize({ width: 390, height: 844 });
  check('Arabic messaging mirrors and fits a mobile viewport', await recovered.locator('html').getAttribute('dir') === 'rtl' && await recovered.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await db.messageThread.update({ where: { id: thread.id }, data: { closedAt: new Date() } });
  const closedRead = await patientContext.request.get(`${BASE}/api/messages/conversations/${thread.id}`);
  const closedSend = await patientContext.request.post(`${BASE}/api/messages/conversations/${thread.id}`, { headers: { Origin: BASE }, data: sent.packet });
  check('closed conversations retain history and reject new sends', closedRead.status() === 200 && closedSend.status() === 404);
  check('no browser page errors occurred', errors.length === 0);
  await recovered.screenshot({ path: '.playwright-cli/e2ee-ar-mobile.png', fullPage: true });
  console.log(`${passed} E2EE browser/API checks passed.`);
}
async function cleanup() {
  await browser?.close();
  await db.auditLog.deleteMany({ where: { OR: [{ patientId: { in: patientIds } }, { actorUserId: { in: users } }] } });
  await db.patientDoctorLink.deleteMany({ where: { patientId: { in: patientIds } } });
  await db.doctorProfile.deleteMany({ where: { id: { in: doctorIds } } });
  await db.breakGlassGrant.deleteMany({ where: { patientId: { in: patientIds } } });
  await db.patientProfile.deleteMany({ where: { id: { in: patientIds } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  if (specialtyId) await db.specialty.delete({ where: { id: specialtyId } });
  await db.$disconnect();
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
