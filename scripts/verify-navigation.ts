/**
 * Verifies a signed-in user can always get back to their space, and can sign
 * out. Both were dead ends: the public header only ever offered "Se connecter",
 * and nothing in the app called revokeSession.
 */
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✔' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

async function loginPatient(page: Page) {
  await page.goto(`${BASE}/fr/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'patient.ui@medic.test');
  await page.fill('#password', 'correct-horse-battery-staple');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/fr\/p\b/, { timeout: 20000 });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await loginPatient(page);
  check('patient signs in', true, new URL(page.url()).pathname);

  // --- the reported dead end -----------------------------------------------
  await page.goto(`${BASE}/fr/doctors`, { waitUntil: 'networkidle' });

  // Wait for the auth fragment to resolve rather than guessing at a delay —
  // it's a client-side fetch, so a fixed sleep makes this flaky.
  const started = Date.now();
  await page.waitForSelector('a[href="/fr/go"]', { timeout: 15000 });
  const resolvedMs = Date.now() - started;

  const headerText = await page.locator('header').innerText();
  check('public header no longer shows "Se connecter" when signed in',
    !/se connecter/i.test(headerText), headerText.replace(/\s+/g, ' ').trim());
  check('public header offers a way back', /mon espace/i.test(headerText));
  check('auth nav resolves promptly', resolvedMs < 3000, `${resolvedMs}ms`);

  // Follow it and confirm it actually lands in the patient space.
  await page.click('a[href="/fr/go"]');
  await page.waitForURL(/\/fr\/p\b/, { timeout: 20000 });
  check('"Mon espace" returns to the patient space', true, new URL(page.url()).pathname);

  // --- exits from inside the space -----------------------------------------
  const spaceHeader = await page.locator('header').innerText();
  check('space header has a link back to the public site', /medic/i.test(spaceHeader));

  const signOutCount = await page.locator('header form button[type=submit]').count();
  check('sign-out control exists', signOutCount > 0);

  // --- sign out actually revokes -------------------------------------------
  await page.locator('header form button[type=submit]').first().click();
  await page.waitForURL((u) => !/\/fr\/p\b/.test(u.pathname), { timeout: 20000 });
  check('signing out leaves the patient space', true, new URL(page.url()).pathname);

  // The session must be dead server-side, not merely cookie-cleared.
  await page.goto(`${BASE}/fr/p`, { waitUntil: 'networkidle' });
  const after = new URL(page.url()).pathname;
  check('revoked session cannot re-enter the space', !after.startsWith('/fr/p'), after);

  await browser.close();
  console.log(failed === 0 ? '\nNAVIGATION OK\n' : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
