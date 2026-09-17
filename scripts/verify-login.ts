/**
 * Verifies the two-step MFA login in a real browser.
 *
 * The assertion that matters: step two fills ONLY the code field. Credentials
 * used to be wiped by the re-render that revealed the TOTP input, forcing the
 * user to retype their password just to enter six digits.
 *
 * Usage (dev server + fixtures must be up):
 *   BASE_URL=http://localhost:3000 MFA_SECRET=... npx tsx scripts/verify-login.ts
 */
import { chromium } from 'playwright';
import { authenticator } from 'otplib';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.DOCTOR_EMAIL ?? 'doctor.ui@medic.test';
const PASSWORD = process.env.DOCTOR_PASSWORD ?? 'correct-horse-battery-staple';
const SECRET = process.env.MFA_SECRET;

let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✔' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

async function main() {
  if (!SECRET) throw new Error('MFA_SECRET is required.');

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // ---- step one: credentials ------------------------------------------------
  await page.goto(`${BASE}/fr/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');

  await page.waitForSelector('#totp', { timeout: 15000 });
  check('MFA challenge appears only after a valid password', true);

  // ---- step two: the fix ----------------------------------------------------
  const emailVal = await page.inputValue('#email');
  const passVal = await page.inputValue('#password');
  check('email survives the re-render', emailVal === EMAIL, emailVal);
  check('password survives the re-render', passVal.length > 0, passVal ? '' : 'cleared');

  const focused = await page.evaluate(() => document.activeElement?.id);
  check('cursor lands in the code field', focused === 'totp', String(focused));

  // Type ONLY the code, exactly as a human now can.
  await page.fill('#totp', authenticator.generate(SECRET));
  await page.click('button[type=submit]');

  await page.waitForURL(/\/fr\/(d|p|admin)\b/, { timeout: 20000 });
  const landing = new URL(page.url()).pathname;
  check('signs in with the code alone', true, landing);
  check('doctor lands in the doctor space', landing.startsWith('/fr/d'), landing);

  // ---- the calendar is reachable and populated ------------------------------
  await page.goto(`${BASE}/fr/d/calendar`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const blocks = await page.locator('button[title*="·"]').count();
  check('calendar renders appointments', blocks > 0, `${blocks} blocks`);

  await browser.close();
  console.log(failed === 0 ? '\nLOGIN OK\n' : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
