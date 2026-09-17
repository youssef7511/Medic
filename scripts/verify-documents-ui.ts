/**
 * Drives the documents/prescriptions UI end to end in a real browser.
 *
 * Proves the full safety loop: a patient records an allergy → the doctor sees
 * it on the prescribing screen → issue is gated on acknowledgment → the
 * prescription is issued, appears in both timelines, and downloads as a PDF →
 * a DOCTOR_STAFF account is blocked from prescribing and from the download (§5).
 *
 * Usage: BASE_URL=... LINK_ID=... DOCTOR_ID=... MFA_SECRET=... npx tsx scripts/verify-documents-ui.ts
 */
import { chromium, type Page, type Browser } from 'playwright';
import { authenticator } from 'otplib';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const LINK_ID = process.env.LINK_ID!;
const DOCTOR_ID = process.env.DOCTOR_ID!;
const SECRET = process.env.MFA_SECRET!;
const PW = 'correct-horse-battery-staple';

let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✔' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

async function loginPatient(page: Page) {
  await page.goto(`${BASE}/fr/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'patient.ui@medic.test');
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/fr\/p\b/, { timeout: 20000 });
}

async function loginMfa(page: Page, email: string) {
  await page.goto(`${BASE}/fr/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  await page.waitForSelector('#totp', { timeout: 15000 });
  await page.fill('#totp', authenticator.generate(SECRET));
  await page.click('button[type=submit]');
  await page.waitForURL(/\/fr\/d\b/, { timeout: 20000 });
}

async function patientRecordsAllergy(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginPatient(page);
  await page.goto(`${BASE}/fr/p/allergies`, { waitUntil: 'networkidle' });
  await page.fill('#allergies', 'Pénicilline');
  await page.click('button:has-text("Enregistrer")');
  await page.waitForSelector('text=Enregistré', { timeout: 15000 });
  check('patient records a drug allergy', true);
  await ctx.close();
}

async function doctorIssues(browser: Browser): Promise<string> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginMfa(page, 'doctor.ui@medic.test');

  await page.goto(`${BASE}/fr/d/patients/${LINK_ID}/prescribe`, { waitUntil: 'networkidle' });
  check('doctor reaches the prescribing screen', /\/prescribe$/.test(new URL(page.url()).pathname));

  const allergyShown = await page.locator('text=Pénicilline').first().isVisible();
  check('the allergy panel shows the patient allergy', allergyShown);

  // Issue button disabled until a line is filled AND the box is ticked.
  const issueBtn = page.locator('button:has-text("Émettre")');
  check('issue is disabled before acknowledgment', await issueBtn.isDisabled());

  await page.locator('input[placeholder="Médicament *"]').first().fill('Amoxicilline');
  await page.locator('input[placeholder="Posologie *"]').first().fill('500 mg');
  check('issue still disabled with meds but no acknowledgment', await issueBtn.isDisabled());

  await page.locator('input[type=checkbox]').first().check();
  check('issue enabled after acknowledgment', !(await issueBtn.isDisabled()));

  await issueBtn.click();
  await page.waitForSelector('text=/a été émise/', { timeout: 20000 });
  check('prescription issued via the UI', true);

  // Grab the issued document id from the timeline.
  await page.goto(`${BASE}/fr/d/patients/${LINK_ID}/documents`, { waitUntil: 'networkidle' });
  const href = await page.locator('a[href^="/api/documents/"]').first().getAttribute('href');
  check('issued document appears in the doctor timeline', !!href, href ?? '');
  await ctx.close();
  return href!.split('/').pop()!;
}

async function patientDownloads(browser: Browser, docId: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginPatient(page);
  await page.goto(`${BASE}/fr/p/doctors/${DOCTOR_ID}/documents`, { waitUntil: 'networkidle' });

  const visible = await page.locator('a[href^="/api/documents/"]').first().isVisible();
  check('prescription appears in the patient timeline', visible);

  // Fetch the PDF through the authorized route using the patient's session.
  const res = await page.request.get(`${BASE}/api/documents/${docId}`);
  const buf = await res.body();
  check('patient can download the PDF (200)', res.status() === 200, `status ${res.status()}`);
  check('the download is a real PDF', buf[0] === 0x25 && buf[1] === 0x50);
  check('content-type is application/pdf', (res.headers()['content-type'] ?? '').includes('pdf'));
  await ctx.close();
}

async function staffBlocked(browser: Browser, docId: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginMfa(page, 'staff.ui@medic.test');

  const presc = await page.goto(`${BASE}/fr/d/patients/${LINK_ID}/prescribe`, {
    waitUntil: 'networkidle',
  });
  const body = (await page.locator('body').innerText()).toLowerCase();
  check(
    'staff blocked from the prescribing screen (§5)',
    presc?.status() === 404 || body.includes('not be found') || body.includes('404'),
    `status ${presc?.status()}`,
  );

  const dl = await page.request.get(`${BASE}/api/documents/${docId}`);
  check('staff blocked from the document download (§5)', dl.status() === 404, `status ${dl.status()}`);
  await ctx.close();
}

async function main() {
  if (!LINK_ID || !DOCTOR_ID || !SECRET) throw new Error('LINK_ID, DOCTOR_ID, MFA_SECRET required.');
  const browser = await chromium.launch();
  console.log('\npatient → allergy');
  await patientRecordsAllergy(browser);
  console.log('\ndoctor → prescribe');
  const docId = await doctorIssues(browser);
  console.log('\npatient → download');
  await patientDownloads(browser, docId);
  console.log('\nstaff (§5)');
  await staffBlocked(browser, docId);
  await browser.close();
  console.log(failed === 0 ? '\nDOCUMENTS UI OK\n' : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
