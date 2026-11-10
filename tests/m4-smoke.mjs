/**
 * tests/m4-smoke.mjs — Milestone 4 end-to-end browser + MySQL persistence smoke test.
 *
 * Verifies the full Milestone 4 user workflow against the live Spring Boot + MySQL backend:
 *   1. Register a new user via UI
 *   2. Verify OTP via UI
 *   3. Retrieve authenticated profile (/api/auth/me)
 *   4. Log out and log back in with the new user's credentials
 *   5. Verify cross-user isolation (new user sees 0 conversations, not demo user's)
 *   6. Create a conversation & send a user message
 *   7. Verify both USER and ASSISTANT messages are saved in MySQL
 *   8. Refresh the page and verify conversation + messages reload from MySQL
 *   9. Rename the conversation and verify MySQL persistence
 *  10. Clear conversation messages via UI and verify MySQL persistence
 *  11. Delete the conversation and verify MySQL persistence
 *  12. Log out, log in as demo user, and verify only demo user's conversations appear
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4319;
const FRONTEND = `http://127.0.0.1:${PORT}`;
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
  console.error('No Chrome/Edge binary found.');
  process.exit(1);
}

const results = [];
let currentStep = 'startup';

function step(name) {
  currentStep = name;
  console.log(`\n▶ ${name}`);
}

async function check(label, fn) {
  try {
    const val = await fn();
    if (val === false) throw new Error('assertion returned false');
    results.push({ step: currentStep, ok: true, label });
    console.log(`  ✓ ${label}${val && val !== true ? ` → ${val}` : ''}`);
    return val;
  } catch (error) {
    results.push({ step: currentStep, ok: false, label, error });
    console.log(`  ✗ ${label}: ${error.message}`);
    throw error;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
  return true;
}

function startStaticServer() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'tools', 'serve.js'), String(PORT)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('http://')) resolve(child);
    });
    setTimeout(() => resolve(child), 1500);
  });
}

const server = await startStaticServer();
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(err.message));

// Intercept /api/auth/register response to read devOtp for the UI OTP form
let capturedDevOtp = null;
page.on('response', async (res) => {
  if (res.url().endsWith('/api/auth/register') && res.request().method() === 'POST' && res.status() === 200) {
    try {
      const body = await res.json();
      if (body?.devOtp) capturedDevOtp = body.devOtp;
    } catch {
      /* ignore */
    }
  }
});

const testEmail = `m4.e2e.${Date.now()}@example.com`;
const testPassword = 'StrongPassword@123';
const testName = 'Meera Krishnan';

try {
  /* ----------------------------------------------------------------
     1. Register a new user via UI
     ---------------------------------------------------------------- */
  step('1. Register a new user & verify OTP');
  await page.goto(FRONTEND, { waitUntil: 'networkidle0' });
  await page.waitForSelector('html[data-app-ready="true"]', { timeout: 10000 });

  await page.click('[data-goto-auth="register"]');
  await page.waitForSelector('#register-form:not([hidden])', { timeout: 5000 });

  await page.type('#register-name', testName);
  await page.type('#register-email', testEmail);
  await page.type('#register-phone', '+91 98765 11223');
  await page.type('#register-password', testPassword);
  await page.click('#register-form button[type="submit"]');

  await page.waitForSelector('#verify-otp-form:not([hidden])', { timeout: 8000 });
  await check('OTP verification screen opens and devOtp was generated', async () => {
    assert(capturedDevOtp && /^\d{6}$/.test(capturedDevOtp), `invalid devOtp: ${capturedDevOtp}`);
    return `OTP generated (${capturedDevOtp})`;
  });

  await page.type('#otp-code', capturedDevOtp);
  await page.click('#verify-otp-form button[type="submit"]');

  await page.waitForSelector('#app-shell:not([hidden])', { timeout: 10000 });
  await check('OTP verification completes registration and opens app shell', async () => {
    const state = await page.evaluate(() => window.__ytalks.store.getState());
    assert(state.session.isAuthenticated, 'not authenticated');
    assert(state.session.user.email === testEmail, `unexpected user email ${state.session.user.email}`);
    return `${state.session.user.name} <${state.session.user.email}>`;
  });

  /* ----------------------------------------------------------------
     2. Verify /api/auth/me profile endpoint and empty initial history
     ---------------------------------------------------------------- */
  step('2. Authenticated profile & user isolation');
  const jwt = await page.evaluate(() => localStorage.getItem('ytalks.authToken'));
  await check('GET /api/auth/me returns the authenticated user profile from MySQL', async () => {
    const res = await fetch(`${BACKEND}/api/auth/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const profile = await res.json();
    assert(profile.email === testEmail && profile.name === testName, 'profile mismatch');
    return `id=${profile.id}, email=${profile.email}`;
  });

  await check('new user starts with 0 conversations (isolated from demo user)', async () => {
    const count = await page.evaluate(() => window.__ytalks.store.getState().conversations.length);
    assert(count === 0, `expected 0 conversations for new user, got ${count}`);
    return '0 conversations';
  });

  /* ----------------------------------------------------------------
     3. Log out and log back in with the new user
     ---------------------------------------------------------------- */
  step('3. Log out and log in');
  await page.evaluate(() => window.__ytalks.actions.logout());
  await page.waitForSelector('#auth-screen:not([hidden])', { timeout: 5000 });
  await check('logout clears JWT token and returns to login screen', async () => {
    const token = await page.evaluate(() => localStorage.getItem('ytalks.authToken'));
    assert(!token, 'token still present after logout');
    return 'token cleared';
  });

  await page.type('#login-email', testEmail);
  await page.type('#login-password', testPassword);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell:not([hidden])', { timeout: 8000 });
  const loginJwt = await page.evaluate(() => localStorage.getItem('ytalks.authToken'));
  await check('login succeeds with registered credentials and issues fresh JWT', async () => {
    assert(loginJwt && loginJwt.split('.').length === 3, 'invalid JWT');
    return 'JWT valid';
  });

  /* ----------------------------------------------------------------
     4. Create conversation, send user message, receive assistant reply, verify MySQL
     ---------------------------------------------------------------- */
  step('4. Conversation & message persistence in MySQL');
  await page.evaluate(() => {
    window.__ytalks.actions.setSettings({ mockLatencyMs: 80, streamTokens: true });
  });

  await page.click('#new-chat');
  await page.click('#composer-input');
  await page.type('#composer-input', 'Explain database indexing in MySQL.', { delay: 2 });
  await page.keyboard.press('Enter');

  await page.waitForFunction(
    () =>
      document.querySelectorAll('.msg--ai .msg__bubble').length >= 1 &&
      !document.querySelector('[data-testid="streaming-message"]'),
    { timeout: 20000 }
  );

  const createdConvId = await check('conversation, USER message, and ASSISTANT message are saved in MySQL', async () => {
    const listRes = await fetch(`${BACKEND}/api/conversations`, {
      headers: { Authorization: `Bearer ${loginJwt}` },
    });
    assert(listRes.status === 200, `list status ${listRes.status}`);
    const list = await listRes.json();
    assert(list.length === 1, `expected 1 conversation in MySQL, got ${list.length}`);

    const detailRes = await fetch(`${BACKEND}/api/conversations/${list[0].id}`, {
      headers: { Authorization: `Bearer ${loginJwt}` },
    });
    assert(detailRes.status === 200, `detail status ${detailRes.status}`);
    const detail = await detailRes.json();
    assert(detail.messages.length === 2, `expected 2 messages in MySQL, got ${detail.messages.length}`);
    assert(detail.messages[0].senderType === 'USER', `first message was ${detail.messages[0].senderType}`);
    assert(detail.messages[1].senderType === 'ASSISTANT', `second message was ${detail.messages[1].senderType}`);
    assert(/Explain database indexing/i.test(detail.title), `auto-derived title not persisted: ${detail.title}`);
    return `convId=${detail.id}, messages=${detail.messages.length}, title="${detail.title}"`;
  });

  /* ----------------------------------------------------------------
     5. Refresh page and verify retrieval from MySQL
     ---------------------------------------------------------------- */
  step('5. Page refresh persistence');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('html[data-app-ready="true"]', { timeout: 10000 });
  await check('conversation and messages reload from MySQL after page refresh', async () => {
    const info = await page.evaluate(() => {
      const s = window.__ytalks.store.getState();
      const c = s.conversations[0];
      return {
        authed: s.session.isAuthenticated,
        convCount: s.conversations.length,
        msgCount: c?.messages?.length || 0,
        domBubbles: document.querySelectorAll('.msg').length,
      };
    });
    assert(info.authed, 'session lost on refresh');
    assert(info.convCount === 1, `expected 1 conversation, got ${info.convCount}`);
    assert(info.msgCount === 2 && info.domBubbles === 2, `expected 2 messages, got ${JSON.stringify(info)}`);
    return `${info.convCount} conversation, ${info.msgCount} messages rendered`;
  });

  /* ----------------------------------------------------------------
     6. Rename, clear messages, and delete conversation
     ---------------------------------------------------------------- */
  step('6. Rename, clear, and delete persisted in MySQL');
  await page.evaluate((id) => {
    window.__ytalks.actions.renameConversation(String(id), 'MySQL Indexing Deep Dive');
  }, createdConvId.split(',')[0].split('=')[1]);

  // Wait briefly for async PATCH to complete
  await new Promise((r) => setTimeout(r, 400));
  const numericConvId = createdConvId.split(',')[0].split('=')[1];

  await check('renameConversation persists new title in MySQL without losing provider/model', async () => {
    const res = await fetch(`${BACKEND}/api/conversations/${numericConvId}`, {
      headers: { Authorization: `Bearer ${loginJwt}` },
    });
    const detail = await res.json();
    assert(detail.title === 'MySQL Indexing Deep Dive', `title in MySQL was "${detail.title}"`);
    assert(detail.providerId && detail.model, `provider/model overwritten: ${detail.providerId}/${detail.model}`);
    return `"${detail.title}" (${detail.providerId}/${detail.model})`;
  });

  await page.evaluate((id) => {
    window.__ytalks.actions.clearConversation(String(id));
  }, numericConvId);
  await new Promise((r) => setTimeout(r, 400));

  await check('clearConversation removes all messages in MySQL and resets title', async () => {
    const res = await fetch(`${BACKEND}/api/conversations/${numericConvId}`, {
      headers: { Authorization: `Bearer ${loginJwt}` },
    });
    const detail = await res.json();
    assert(detail.messages.length === 0, `expected 0 messages in MySQL, got ${detail.messages.length}`);
    assert(detail.title === 'New conversation', `expected reset title, got "${detail.title}"`);
    return '0 messages in MySQL';
  });

  await page.evaluate((id) => {
    window.__ytalks.actions.deleteConversation(String(id));
  }, numericConvId);
  await new Promise((r) => setTimeout(r, 400));

  await check('deleteConversation removes the conversation from MySQL', async () => {
    const res = await fetch(`${BACKEND}/api/conversations/${numericConvId}`, {
      headers: { Authorization: `Bearer ${loginJwt}` },
    });
    assert(res.status === 404, `expected 404 after delete, got ${res.status}`);
    return '404 Not Found in MySQL';
  });

  /* ----------------------------------------------------------------
     7. Log out and log in as demo user to verify user isolation
     ---------------------------------------------------------------- */
  step('7. Demo user isolation check');
  await page.evaluate(() => window.__ytalks.actions.logout());
  await page.waitForSelector('#auth-screen:not([hidden])', { timeout: 5000 });
  await page.click('#fill-demo-login');
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell:not([hidden])', { timeout: 8000 });

  await check('logging in as demo user displays only demo user conversations', async () => {
    const info = await page.evaluate(() => {
      const s = window.__ytalks.store.getState();
      return {
        email: s.session.user.email,
        count: s.conversations.length,
        titles: s.conversations.map((c) => c.title),
      };
    });
    assert(info.email === 'aarav.sharma@example.com', `unexpected user ${info.email}`);
    assert(info.count >= 5, `expected demo conversations, got ${info.count}`);
    assert(!info.titles.includes('MySQL Indexing Deep Dive'), 'other user conversation leaked');
    return `${info.count} demo conversations loaded`;
  });

  await check('no uncaught page or console errors', async () => {
    const noisy = consoleErrors.filter((e) => !/favicon/i.test(e));
    assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
    assert(noisy.length === 0, `console errors: ${noisy.join(' | ')}`);
    return 'clean';
  });
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n================================================================`);
console.log(`Milestone 4 E2E smoke test — ${results.length - failed.length}/${results.length} checks passed`);
console.log(`================================================================`);
process.exit(failed.length ? 1 : 0);
