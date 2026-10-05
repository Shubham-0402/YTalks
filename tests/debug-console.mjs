/**
 * tests/debug-console.mjs — loads the page in real Chrome and prints every
 * console message, page error and failed request. Used to diagnose boot
 * problems before running the full smoke test.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4321;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.js'), String(PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 1200));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();

page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.stack || e.message}`));
page.on('requestfailed', (r) => console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`);
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));

const ready = await page.evaluate(() => document.documentElement.dataset.appReady || 'NOT SET');
console.log(`appReady = ${ready}`);

await browser.close();
server.kill();
