/**
 * Reproduces the reported "can never get back to espace patient" problem.
 * Walks the patient space as a patient, and separately checks what a doctor
 * sees when they land on /p.
 */
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

async function loginPatient(page: Page) {
  await page.goto(`${BASE}/fr/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'patient.ui@medic.test');
  await page.fill('#password', 'correct-horse-battery-staple');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/fr\/(p|d|admin)\b/, { timeout: 20000 });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });

  await loginPatient(page);
  console.log(`after login          : ${new URL(page.url()).pathname}`);

  // Walk every patient-space route and report where we actually end up.
  for (const path of ['/fr/p', '/fr/p/appointments', '/fr/p', '/fr/doctors', '/fr/p']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const landed = new URL(page.url()).pathname;
    const flag = landed === path ? 'ok  ' : 'MOVED';
    console.log(`${flag} ${path.padEnd(22)} → ${landed}`);
  }

  // Does the header nav actually offer a way back?
  await page.goto(`${BASE}/fr/p/appointments`, { waitUntil: 'networkidle' });
  const navLinks = await page.locator('header a').allTextContents();
  console.log(`header links         : ${JSON.stringify(navLinks)}`);

  const hrefs = await page.locator('header a').evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute('href')),
  );
  console.log(`header hrefs         : ${JSON.stringify(hrefs)}`);

  // Is there any sign-out control at all?
  const bodyText = await page.locator('body').innerText();
  console.log(`sign-out present     : ${/déconnexion|logout|se déconnecter/i.test(bodyText)}`);

  await ctx.close();

  // ---- now as the doctor ---------------------------------------------------
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(`${BASE}/fr/login`, { waitUntil: 'networkidle' });
  await page2.fill('#email', 'doctor.ui@medic.test');
  await page2.fill('#password', 'correct-horse-battery-staple');
  await page2.click('button[type=submit]');
  await page2.waitForSelector('#totp', { timeout: 15000 });
  console.log('\ndoctor: stopped at MFA (expected, no code supplied here)');
  await ctx2.close();

  await browser.close();

  if (errors.length) {
    console.log('\nerrors / non-200s:');
    for (const e of [...new Set(errors)].slice(0, 12)) console.log('  -', e);
  } else {
    console.log('\nno page errors or non-200 responses');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
