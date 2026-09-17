/**
 * Drives the running app in a real browser: logs a doctor in through the full
 * credentials + TOTP flow, then captures the calendar in both locales.
 *
 * This is the only way to verify the RTL grid actually mirrors — no unit test
 * can tell you whether Monday landed on the right in Arabic.
 *
 * Usage: BASE_URL=http://localhost:3000 MFA_SECRET=... npx tsx scripts/screenshot.ts
 */
import { chromium } from 'playwright';
import { authenticator } from 'otplib';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.DEMO_EMAIL ?? 'dr.demo@medic.test';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1234';
const SECRET = process.env.MFA_SECRET;

const OUT = '.playwright-cli';

async function main() {
  if (!SECRET) throw new Error('MFA_SECRET is required (from demo-seed output).');
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  // ---- login: password step -------------------------------------------------
  await page.goto(`${BASE}/fr/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');

  // ---- login: TOTP step -----------------------------------------------------
  // The code field only appears once the server confirms MFA is required, which
  // is itself the assertion that the §10 gate is live.
  await page.waitForSelector('#totp', { timeout: 15000 });
  console.log('✔ MFA challenge presented after valid password');

  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.fill('#totp', authenticator.generate(SECRET));
  await page.click('button[type=submit]');

  await page.waitForURL(/\/fr\/(p|d)\b/, { timeout: 20000 });
  console.log(`✔ signed in → ${new URL(page.url()).pathname}`);

  // ---- calendar, French (LTR) ----------------------------------------------
  await page.goto(`${BASE}/fr/d/calendar`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const blocks = await page.locator('button[title*="·"]').count();
  console.log(`✔ calendar rendered ${blocks} appointment blocks`);
  await page.screenshot({ path: `${OUT}/calendar-fr.png`, fullPage: true });

  // ---- calendar, Arabic (RTL) ----------------------------------------------
  await page.goto(`${BASE}/ar/d/calendar`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const dir = await page.getAttribute('html', 'dir');
  console.log(`✔ arabic page dir="${dir}"`);
  await page.screenshot({ path: `${OUT}/calendar-ar.png`, fullPage: true });

  // ---- availability editor --------------------------------------------------
  await page.goto(`${BASE}/fr/d/availability`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/availability-fr.png`, fullPage: true });

  // Did the page body scroll sideways? (§9 requires it never does.)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );

  await browser.close();

  console.log(overflow ? '✗ page overflows horizontally' : '✔ no horizontal page overflow');
  if (problems.length > 0) {
    console.log('\nbrowser problems:');
    for (const p of [...new Set(problems)].slice(0, 10)) console.log('  -', p);
  } else {
    console.log('✔ no console errors');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
