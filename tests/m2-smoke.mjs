/**
 * tests/m2-smoke.mjs — Milestone 2 backend + frontend integration check.
 *
 * Verifies the whole chain:
 *   1. Spring Boot GET /api/health answers directly (Node fetch).
 *   2. Browser -> Spring Boot: the frontend status badge reads "connected".
 *   3. Offline resilience: with the backend unreachable the badge reads
 *      "offline" and the page stays error-free (no uncaught exceptions).
 *
 * Prerequisites: the backend jar built (`mvn package` in backend/) and
 * running on http://localhost:8080. It does NOT start the backend itself —
 * run it separately so logs stay visible.
 *
 * Run:  node tests/m2-smoke.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;
const BACKEND = process.env.YTALKS_BACKEND_URL || 'http://localhost:8080';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.CHROME_PATH,
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome/Edge binary found. Set CHROME_PATH and retry.');
  process.exit(1);
}

const results = [];
let currentStep = 'startup';
const step = (name) => { currentStep = name; console.log(`\n▶ ${name}`); };
const pass = (m) => { results.push({ ok: true }); console.log(`  ✓ ${m}`); };
const fail = (m, e) => {
  results.push({ ok: false });
  console.log(`  ✗ ${m}`);
  if (e) console.log(`      ${String(e.message || e).split('\n')[0]}`);
};
async function check(label, fn) {
  try {
    const v = await fn();
    if (v === false) throw new Error('assertion returned false');
    pass(label);
  } catch (e) { fail(label, e); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'tools', 'serve.js'), String(PORT)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    child.stdout.on('data', (chunk) => {
      if (!settled && String(chunk).includes('http://')) { settled = true; resolve(child); }
    });
    child.on('exit', (code) => { if (!settled) reject(new Error(`server exited early: ${code}`)); });
    setTimeout(() => { if (!settled) { settled = true; resolve(child); } }, 1500);
  });
}

/* ------------------------------------------------------------------ */

step('backend answers directly');
await check('GET /api/health returns UP JSON', async () => {
  const res = await fetch(`${BACKEND}/api/health`, { headers: { Accept: 'application/json' } });
  assert(res.ok, `expected 200, got ${res.status}`);
  assert((res.headers.get('content-type') || '').includes('application/json'), 'expected JSON content type');
  const body = await res.json();
  assert(body.status === 'UP', `status is ${body.status}`);
  assert(body.service === 'Ytalks backend', `service is ${body.service}`);
  assert(typeof body.version === 'string', 'version present');
  assert(Array.isArray(body.checks) && body.checks.length >= 1, 'checks present');
});
await check('every response carries X-Request-Id', async () => {
  const res = await fetch(`${BACKEND}/api/health`);
  assert(res.headers.get('x-request-id'), 'missing X-Request-Id header');
});
await check('unknown path returns the JSON error envelope', async () => {
  const res = await fetch(`${BACKEND}/api/no-such-endpoint`);
  assert(res.status === 404, `expected 404, got ${res.status}`);
  const body = await res.json();
  assert(body.code === 'NOT_FOUND', `code is ${body.code}`);
  assert(typeof body.requestId === 'string', 'requestId present');
});

/* ------------------------------------------------------------------ */

step('browser → backend badge');
const server = await startServer();
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(
  () => document.documentElement.dataset.appReady === 'true',
  { timeout: 15000 }
);

await check('status badge exists in the chat header', async () => {
  const badge = await page.$('[data-testid="backend-status"]');
  assert(badge, 'badge missing');
});
await check('badge flips to "connected" while backend is up', async () => {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="backend-status"]')?.dataset.state === 'online',
    { timeout: 15000 }
  );
  const label = await page.$eval('[data-testid="backend-status"]', (n) => n.textContent.trim());
  assert(/connected/i.test(label), `badge reads "${label}"`);
});
await check('badge uses the success style when online', async () => {
  const state = await page.$eval('[data-testid="backend-status"]', (n) => n.dataset.state);
  assert(state === 'online', `state is ${state}`);
});

step('offline resilience');
await check('badge degrades to "offline" without page errors', async () => {
  await page.evaluate(() => {
    localStorage.setItem('ytalks.backendBase', 'http://127.0.0.1:59999');
  });
  await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.appReady === 'true',
    { timeout: 15000 }
  );
  await page.waitForFunction(
    () => document.querySelector('[data-testid="backend-status"]')?.dataset.state === 'offline',
    { timeout: 15000 }
  );
  const label = await page.$eval('[data-testid="backend-status"]', (n) => n.textContent.trim());
  assert(/offline/i.test(label), `badge reads "${label}"`);
  await page.evaluate(() => localStorage.removeItem('ytalks.backendBase'));
});

await check('no console or page errors from the integration', async () => {
  await sleep(500);
  // "Failed to load resource" is Chrome's network-level note for the refused
  // health fetch itself — expected while offline, and the app handles it.
  const relevant = consoleErrors.filter(
    (m) => !/favicon/i.test(m) && !/failed to load resource/i.test(m)
  );
  assert(relevant.length === 0, `console errors: ${relevant.slice(0, 2).join(' | ')}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.slice(0, 2).join(' | ')}`);
});

/* ------------------------------------------------------------------ */

await browser.close();
server.kill();
await sleep(300);

const failed = results.filter((r) => !r.ok);
console.log(`\nMilestone 2 smoke — ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
