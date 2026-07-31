/**
 * Drives the consultation-notes UI in a real browser.
 *
 * Proves what unit/e2e cannot: a doctor can write and edit a note through the
 * actual page, and a DOCTOR_STAFF account is blocked from clinical content (§5).
 *
 * Usage: BASE_URL=http://localhost:3000 LINK_ID=... MFA_SECRET=... npx tsx scripts/verify-notes-ui.ts
 */
import { chromium, type Page, type Browser } from 'playwright';
import { authenticator } from 'otplib';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const LINK_ID = process.env.LINK_ID!;
const SECRET = process.env.MFA_SECRET!;
const PASSWORD = 'correct-horse-battery-staple';

let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✔' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

async function loginWithMfa(page: Page, email: string) {
  await page.goto(`${BASE}/fr/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('#totp', { timeout: 15000 });
  await page.fill('#totp', authenticator.generate(SECRET));
  await page.click('button[type=submit]');
  await page.waitForURL(/\/fr\/(d|p|admin)\b/, { timeout: 20000 });
}

async function asDoctor(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginWithMfa(page, 'doctor.ui@medic.test');

  const notesUrl = `${BASE}/fr/d/patients/${LINK_ID}/notes`;
  await page.goto(notesUrl, { waitUntil: 'networkidle' });
  check('doctor reaches the notes page', /\/notes$/.test(new URL(page.url()).pathname));

  const historyBefore = await page.locator('text=/Historique \\(\\d+\\)/').count();

  // Write a new note.
  await page.click('button:has-text("Nouvelle note")');
  const body = `Patient E2E — douleur thoracique. ${Date.now()}`;
  await page.fill('textarea', body);
  await page.click('button:has-text("Enregistrer")');

  // Wait for the composer to close and the journal to gain a committed entry —
  // a new note carries its own "Historique" control, so the count rising proves
  // it landed in the list rather than merely sitting in the textarea.
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll('textarea').length === 0 &&
      [...document.querySelectorAll('button')].filter((b) => /Historique \(\d+\)/.test(b.textContent ?? '')).length > n,
    historyBefore,
    { timeout: 15000 },
  );
  check('a written note appears in the journal with its history control', true);

  // Retract flow: the dialog holds the only textarea once the composer is closed.
  const retractCountBefore = await page.locator('button:has-text("Rétracter")').count();
  await page.locator('button:has-text("Rétracter")').first().click();
  const dialog = page.locator('[role=dialog]');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  const confirmBtn = dialog.locator('button:has-text("Confirmer la rétractation")');
  check('retract confirm is disabled without a reason', await confirmBtn.isDisabled());
  await dialog.locator('textarea').fill('Saisie dans le mauvais dossier patient.');
  await confirmBtn.click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });

  // A retracted note is HIDDEN from the default journal (spec §4). Confirm it
  // left the default view, then reappears struck-through under the toggle.
  await page.waitForFunction(
    (target) =>
      [...document.querySelectorAll('button')].filter((b) => /Rétracter/.test(b.textContent ?? ''))
        .length === target,
    retractCountBefore - 1,
    { timeout: 15000 },
  );
  check('retracting removes the note from the default journal', true);

  await page.goto(`${BASE}/fr/d/patients/${LINK_ID}/notes?retracted=1`, {
    waitUntil: 'networkidle',
  });
  const struck = await page.locator('.line-through').first().isVisible();
  const reasonShown = await page.locator('text=/mauvais dossier patient/').first().isVisible();
  check('retracted view shows it struck through with the reason', struck && reasonShown);

  await ctx.close();
}

async function asStaff(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginWithMfa(page, 'staff.ui@medic.test');

  // §5: staff can reach the calendar but never clinical notes. Direct URL → 404.
  const resp = await page.goto(`${BASE}/fr/d/patients/${LINK_ID}/notes`, {
    waitUntil: 'networkidle',
  });
  const bodyText = (await page.locator('body').innerText()).toLowerCase();
  const blocked =
    resp?.status() === 404 || bodyText.includes('404') || bodyText.includes('not be found');
  check('staff is blocked from the notes page (§5)', blocked, `status ${resp?.status()}`);

  await ctx.close();
}

async function main() {
  if (!LINK_ID || !SECRET) throw new Error('LINK_ID and MFA_SECRET are required.');
  const browser = await chromium.launch();
  console.log('\ndoctor');
  await asDoctor(browser);
  console.log('\nstaff (§5)');
  await asStaff(browser);
  await browser.close();
  console.log(failed === 0 ? '\nNOTES UI OK\n' : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
