/** Browser regression: booking navigation, patient uploads and doctor-to-patient PDF delivery.
 * Uses uniquely named fictional accounts and removes only its own rows and objects.
 * Requires a running local app, Postgres and MinIO with matching environment settings.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { authenticator } from 'otplib';
import { PrismaClient, Role, ScopeType, Sex } from '@prisma/client';
import { hash } from 'bcryptjs';
import { renderPrescriptionPdf } from '../src/lib/documents/render';
import { decryptText } from '../src/lib/crypto/envelope';
import { getObjectStore } from '../src/lib/storage';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) throw new Error('Run against a local app only.');
const db = new PrismaClient();
const stamp = Date.now();
const password = randomBytes(18).toString('hex');
const secret = authenticator.generateSecret();
const users: string[] = [];
const doctorIds: string[] = [];
const patientIds: string[] = [];
let specialtyId: string | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const problems: string[] = [];
let passed = 0;
function check(label: string, condition: boolean) { assert.ok(condition, label); passed++; console.log(`PASS ${label}`); }

async function patient(tag: string) {
  const user = await db.user.create({ data: { email: `uploads-${tag}-${stamp}@e2e.test`, passwordHash: await hash(password, 10) } });
  users.push(user.id);
  await db.roleAssignment.create({ data: { userId: user.id, role: Role.PATIENT, scopeType: ScopeType.GLOBAL, grantedBy: 'e2e-patient-documents' } });
  const profile = await db.patientProfile.create({ data: { userId: user.id, firstName: 'Patient', lastName: tag,
    dateOfBirth: new Date('1990-01-01'), sex: Sex.MALE, phone: '', allergiesAffirmedNone: true } });
  patientIds.push(profile.id);
  return { user, profile };
}
async function login(page: Page, email: string, role: 'patient' | 'doctor') {
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(`${BASE}/fr/login/${role}`, { waitUntil: 'networkidle' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type=submit]').click();
  if (role === 'doctor') {
    await page.locator('#totp').waitFor({ timeout: 30000 });
    await page.locator('#totp').fill(authenticator.generate(secret));
    await page.locator('button[type=submit]').click();
  }
  await page.waitForURL(/\/fr\/(p|d)(\/|$)/, { timeout: 30000 });
}
async function main() {
  const specialty = await db.specialty.create({ data: { slug: `uploads-test-${stamp}`, name: { fr: 'Médecine test', ar: 'طب الاختبار' } } });
  specialtyId = specialty.id;
  const doctorUser = await db.user.create({ data: { email: `uploads-doctor-${stamp}@e2e.test`, passwordHash: await hash(password, 10), mfaSecret: secret } });
  users.push(doctorUser.id);
  await db.roleAssignment.create({ data: { userId: doctorUser.id, role: Role.DOCTOR, scopeType: ScopeType.GLOBAL, grantedBy: 'e2e-patient-documents' } });
  const doctor = await db.doctorProfile.create({ data: { userId: doctorUser.id, specialtyId: specialty.id,
    slug: `uploads-doctor-${stamp}`, licenseNumber: 'E2E-FICTIONAL', headline: { fr: `Dr Documents ${stamp}`, ar: 'طبيب المستندات' }, bio: { fr: 'Fictional integration test', ar: 'اختبار' }, languages: ['fr'], isPublished: true } });
  doctorIds.push(doctor.id);
  const clinic = await db.clinic.create({ data: { doctorId: doctor.id, name: 'Cabinet de test', address: { city: 'Tunis' } } });
  await db.availabilityRule.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ doctorId: doctor.id, clinicId: clinic.id, weekday, startLocal: '09:00', endLocal: '18:00', slotMinutes: 30, validFrom: new Date('2020-01-01') })) });
  const owner = await patient('owner');
  const outsider = await patient('outsider');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const patientContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await patientContext.newPage();
  await login(page, owner.user.email!, 'patient');
  const bookingPath = `/p/doctors/${doctor.id}/book`;
  await page.goto(`${BASE}/fr/login/patient?next=${encodeURIComponent(bookingPath)}`, { waitUntil: 'networkidle' });
  check('signed-in patient login preserves the requested booking route', new URL(page.url()).pathname === `/fr${bookingPath}`);
  await page.goto(`${BASE}/fr/doctors?q=${stamp}`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Prendre rendez-vous', exact: true }).first().click();
  await page.waitForURL(`**/fr${bookingPath}`);
  check('directory booking button opens the selected doctor’s slots', await page.locator('main button[aria-pressed]').count() > 0);
  await page.locator('main button[aria-pressed]').first().click();
  await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click();
  await page.getByRole('status').filter({ hasText: 'Demande de rendez-vous envoyée' }).waitFor({ timeout: 30000 });
  const link = await db.patientDoctorLink.findUniqueOrThrow({ where: { patientId_doctorId: { patientId: owner.profile.id, doctorId: doctor.id } } });
  check('booking creates an appointment and active care relationship', link.status === 'ACTIVE' && await db.appointment.count({ where: { linkId: link.id } }) === 1);
  const report = await renderPrescriptionPdf({ locale: 'fr', doctorName: 'Laboratoire fictif', licenseNumber: 'TEST', clinicName: 'Test', patientName: 'Patient test', patientDob: '01/01/1990', medications: [], notes: 'Rapport IRM fictif pour vérification technique.', issuedAt: '13/10/2026' });
  await page.goto(`${BASE}/fr/p/documents`, { waitUntil: 'networkidle' });
  await page.locator('select[name=category]').selectOption('MRI');
  await page.locator('input[name=title]').fill('IRM de test');
  await page.locator('input[type=file]').setInputFiles({ name: 'irm.pdf', mimeType: 'application/pdf', buffer: Buffer.from(report.bytes) });
  const uploadedResponse = page.waitForResponse(response => response.url().endsWith('/api/documents/upload') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Envoyer le document', exact: true }).click();
  const response = await uploadedResponse;
  if (response.status() !== 201) throw new Error(`Upload returned ${response.status()}: ${await response.text()}`);
  check('patient upload succeeds over the authenticated API', response.status() === 201);
  const uploaded = await response.json() as { id: string };
  await page.getByRole('status').filter({ hasText: 'Document envoyé' }).waitFor();
  const stored = await db.document.findUniqueOrThrow({ where: { id: uploaded.id } });
  check('upload metadata is encrypted and correctly categorized', !!stored.uploadMetadataEnc && JSON.parse(await decryptText(stored.uploadMetadataEnc!)).category === 'MRI');
  check('uploaded file is encrypted in object storage', !Buffer.from((await getObjectStore().get(stored.storageKey)).body).equals(Buffer.from(report.bytes)));
  await page.reload({ waitUntil: 'networkidle' });
  check('patient sees the uploaded document after reloading', await page.getByText('IRM de test', { exact: true }).count() === 1);
  const patientRead = await patientContext.request.get(`${BASE}/api/documents/${uploaded.id}`);
  check('patient reads exactly the original PDF bytes', patientRead.status() === 200 && (await patientRead.body()).equals(Buffer.from(report.bytes)));
  check('read response is inline and uncached', patientRead.headers()['content-disposition']?.startsWith('inline') === true && patientRead.headers()['cache-control'] === 'private, no-store');
  const attachment = await patientContext.request.get(`${BASE}/api/documents/${uploaded.id}?download=1`);
  check('download response uses attachment disposition', attachment.headers()['content-disposition']?.startsWith('attachment') === true);
  const doctorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const doctorPage = await doctorContext.newPage();
  await login(doctorPage, doctorUser.email!, 'doctor');
  await doctorPage.goto(`${BASE}/fr/d/patients/${link.id}/documents`, { waitUntil: 'networkidle' });
  check('doctor receives the patient’s IRM in the linked record', await doctorPage.getByText('IRM de test', { exact: true }).count() === 1 && await doctorPage.getByText('Envoyé par le patient', { exact: true }).count() === 1);
  const doctorRead = await doctorContext.request.get(`${BASE}/api/documents/${uploaded.id}`);
  check('doctor reads exactly the patient’s uploaded PDF', doctorRead.status() === 200 && (await doctorRead.body()).equals(Buffer.from(report.bytes)));
  await doctorPage.goto(`${BASE}/fr/d/patients/${link.id}/prescribe`, { waitUntil: 'networkidle' });
  await doctorPage.getByPlaceholder('Médicament *', { exact: true }).fill('Médicament fictif de test');
  await doctorPage.getByPlaceholder('Posologie *', { exact: true }).fill('Dosage fictif');
  await doctorPage.getByRole('checkbox').check();
  await doctorPage.getByRole('button', { name: "Émettre l'ordonnance", exact: true }).click();
  await doctorPage.getByText("L'ordonnance a été émise.", { exact: true }).waitFor({ timeout: 30000 });
  const prescription = await db.document.findFirstOrThrow({ where: { linkId: link.id, type: 'PRESCRIPTION' } });
  await page.goto(`${BASE}/fr/p/documents`, { waitUntil: 'networkidle' });
  check('patient receives the doctor’s issued prescription in Mes documents', await page.getByText('Médicament fictif de test', { exact: true }).count() === 1 && await page.getByText('Émis par le médecin', { exact: true }).count() === 1);
  const prescriptionRead = await patientContext.request.get(`${BASE}/api/documents/${prescription.id}`);
  check('patient opens the issued prescription as a valid PDF', prescriptionRead.status() === 200 && prescriptionRead.headers()['content-type'] === 'application/pdf' && (await prescriptionRead.body()).subarray(0, 5).toString() === '%PDF-');
  check('document reads are recorded in the audit trail', await db.auditLog.count({ where: { action: 'document.read', resourceId: prescription.id, actorUserId: owner.user.id } }) > 0);
  const strangerContext = await browser.newContext();
  const strangerPage = await strangerContext.newPage();
  await login(strangerPage, outsider.user.email!, 'patient');
  check('another patient cannot read the upload or prescription', (await strangerContext.request.get(`${BASE}/api/documents/${uploaded.id}`)).status() === 404 && (await strangerContext.request.get(`${BASE}/api/documents/${prescription.id}`)).status() === 404);
  const deniedUpload = await strangerContext.request.post(`${BASE}/api/documents/upload`, { headers: { Origin: BASE }, multipart: { linkId: link.id, title: 'Unauthorized', category: 'MRI', file: { name: 'irm.pdf', mimeType: 'application/pdf', buffer: Buffer.from(report.bytes) } } });
  check('another patient cannot upload into this care relationship', deniedUpload.status() === 404);
  const invalidUpload = await patientContext.request.post(`${BASE}/api/documents/upload`, { headers: { Origin: BASE }, multipart: { linkId: link.id, title: 'Invalid', category: 'MRI', file: { name: 'evil.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<script>bad</script>') } } });
  check('a disguised executable document is rejected', invalidUpload.status() === 400);
  const csrf = await patientContext.request.post(`${BASE}/api/documents/upload`, { headers: { Origin: 'https://other.example' } });
  check('cross-origin uploads are rejected', csrf.status() === 403);
  await page.goto(`${BASE}/ar/p/documents`, { waitUntil: 'networkidle' });
  check('Arabic document page supports RTL and uploads', await page.locator('html').getAttribute('dir') === 'rtl' && await page.locator('input[type=file]').count() === 1);
  await page.setViewportSize({ width: 390, height: 844 });
  check('document upload layout fits mobile', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('browser has no page errors', problems.length === 0);
  mkdirSync('.playwright-cli', { recursive: true });
  await page.screenshot({ path: '.playwright-cli/patient-documents-ar-mobile.png', fullPage: true });
  console.log(`${passed} browser/API checks passed.`);
}

async function cleanup() {
  await browser?.close();
  const links = await db.patientDoctorLink.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } });
  const ids = links.map(link => link.id);
  const docs = await db.document.findMany({ where: { linkId: { in: ids } }, select: { storageKey: true } });
  for (const doc of docs) await getObjectStore().delete(doc.storageKey);
  const appointments = await db.appointment.findMany({ where: { linkId: { in: ids } }, select: { id: true } });
  for (const appointment of appointments) await db.outboxMessage.deleteMany({ where: { payload: { path: ['appointmentId'], equals: appointment.id } } });
  await db.auditLog.deleteMany({ where: { OR: [{ patientId: { in: patientIds } }, { actorUserId: { in: users } }] } });
  await db.patientDoctorLink.deleteMany({ where: { id: { in: ids } } });
  await db.availabilityRule.deleteMany({ where: { doctorId: { in: doctorIds } } });
  await db.clinic.deleteMany({ where: { doctorId: { in: doctorIds } } });
  await db.doctorProfile.deleteMany({ where: { id: { in: doctorIds } } });
  await db.patientProfile.deleteMany({ where: { id: { in: patientIds } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  if (specialtyId) await db.specialty.delete({ where: { id: specialtyId } });
  await db.$disconnect();
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
