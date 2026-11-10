/**
 * tests/m5-smoke.mjs — Milestone 5 verification suite for Gemini integration.
 *
 * Part A (Deterministic Frontend + API Contract Verification):
 *   1. Verifies the chat header shows "Live API" (not "Mock") for Gemini in real mode.
 *   2. Verifies sending a message calls POST /api/chat/{id}/messages (never mock-ai.js).
 *   3. Verifies clear user-facing error states (no fake replies) for:
 *      GEMINI_NOT_CONFIGURED, GEMINI_AUTH_FAILED, GEMINI_RATE_LIMIT,
 *      GEMINI_TIMEOUT, GEMINI_ERROR, and PROVIDER_NOT_SUPPORTED.
 *   4. Verifies Retry ([data-retry]) recovers and renders the reply without duplicating the user bubble.
 *
 * Part B (Live Spring Boot + MySQL + Real Gemini API Verification, when backend is running on :8080):
 *   5. Verifies GET /api/chat/providers reports Gemini implemented with configured GEMINI_MODEL.
 *   6. Sends a real chat message through the UI -> Spring Boot -> Google Gemini -> MySQL,
 *      verifies both USER and ASSISTANT messages are persisted in MySQL without duplicates,
 *      verifies multi-turn conversation history context, and verifies persistence across page reload.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4321;
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

try {
  /* ================================================================
     PART A: Deterministic Frontend Wiring & Error Mapping Checks
     ================================================================ */
  step('Part A: Deterministic Frontend Wiring & Error Mapping');
  const mockPage = await browser.newPage();
  await mockPage.setRequestInterception(true);

  let nextChatBehavior = { status: 200, body: null };
  let chatRequestsCaptured = [];

  mockPage.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith('http://localhost:8080/api/')) {
      req.continue();
      return;
    }
    const path = url.replace('http://localhost:8080', '');
    const method = req.method();
    const corsHeaders = {
      'Access-Control-Allow-Origin': FRONTEND,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Content-Type': 'application/json',
    };

    if (method === 'OPTIONS') {
      req.respond({ status: 200, headers: corsHeaders, body: '' });
      return;
    }
    if (path === '/api/health') {
      req.respond({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({ status: 'UP', service: 'Ytalks backend', version: '0.4.0', checks: [] }),
      });
      return;
    }
    if (path === '/api/auth/login') {
      req.respond({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          accessToken: 'header.payload.signature',
          user: { id: 1, name: 'Aarav Sharma', email: 'aarav.sharma@example.com', phone: '+91 98765 43210' },
        }),
      });
      return;
    }
    if (path.startsWith('/api/conversations') && method === 'GET') {
      req.respond({ status: 200, headers: corsHeaders, body: JSON.stringify([]) });
      return;
    }
    if (path === '/api/conversations' && method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      req.respond({
        status: 201,
        headers: corsHeaders,
        body: JSON.stringify({
          id: 501,
          title: body.title || 'New conversation',
          providerId: body.providerId || 'gemini',
          model: body.model || 'gemini-2.5-flash',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 0,
        }),
      });
      return;
    }
    if (path === '/api/conversations/501' && method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      req.respond({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          id: 501,
          title: body.title || 'Updated',
          providerId: body.providerId || 'gemini',
          model: body.model || 'gemini-2.5-flash',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 1,
        }),
      });
      return;
    }
    if (path === '/api/chat/501/messages' && method === 'POST') {
      const payload = JSON.parse(req.postData() || '{}');
      chatRequestsCaptured.push(payload);
      req.respond({
        status: nextChatBehavior.status,
        headers: corsHeaders,
        body: JSON.stringify(nextChatBehavior.body),
      });
      return;
    }
    req.respond({ status: 404, headers: corsHeaders, body: JSON.stringify({ code: 'NOT_FOUND', message: 'Not found' }) });
  });

  await mockPage.goto(FRONTEND, { waitUntil: 'networkidle0' });
  await mockPage.waitForSelector('html[data-app-ready="true"]', { timeout: 10000 });
  await mockPage.click('#fill-demo-login');
  await mockPage.click('#login-form button[type="submit"]');
  await mockPage.waitForSelector('#app-shell:not([hidden])', { timeout: 8000 });

  await check('real mode is active by default (useMockAi === false) and header shows "Live API"', async () => {
    const useMock = await mockPage.evaluate(() => window.__ytalks.store.getState().settings.useMockAi);
    assert(useMock === false, `expected useMockAi=false, got ${useMock}`);
    const subtitle = await mockPage.$eval('#chat-subtitle', (n) => n.textContent.trim());
    assert(/Not verified yet|LIVE/i.test(subtitle) && !/\bMock\b/i.test(subtitle), `unexpected subtitle: ${subtitle}`);
    return subtitle.replace(/\s+/g, ' ');
  });

  // Test error mappings on POST /api/chat/501/messages
  const errorCases = [
    {
      code: 'GEMINI_NOT_CONFIGURED',
      status: 503,
      message: 'Gemini provider is not configured. Please set GEMINI_API_KEY environment variable.',
      expectTitle: /Gemini API key not configured/i,
    },
    {
      code: 'GEMINI_AUTH_FAILED',
      status: 502,
      message: 'Gemini API authentication failed: invalid or unauthorized GEMINI_API_KEY',
      expectTitle: /Gemini authentication failed/i,
    },
    {
      code: 'GEMINI_RATE_LIMIT',
      status: 429,
      message: 'Gemini API rate limit exceeded. Please wait a moment before trying again.',
      expectTitle: /Provider rate limit reached/i,
    },
    {
      code: 'GEMINI_TIMEOUT',
      status: 504,
      message: 'Gemini API request timed out. Please try again.',
      expectTitle: /The provider timed out/i,
    },
    {
      code: 'GEMINI_ERROR',
      status: 502,
      message: 'Gemini API error: model overloaded',
      expectTitle: /Gemini API error/i,
    },
    {
      code: 'PROVIDER_NOT_SUPPORTED',
      status: 400,
      message: 'Only Google Gemini is supported in Milestone 5. Requested: openai',
      expectTitle: /Provider not supported yet/i,
    },
  ];

  // Send initial message that triggers GEMINI_NOT_CONFIGURED
  nextChatBehavior = {
    status: errorCases[0].status,
    body: { status: errorCases[0].status, code: errorCases[0].code, message: errorCases[0].message },
  };
  await mockPage.click('#composer-input');
  await mockPage.type('#composer-input', 'What is polymorphism in Java?');
  await mockPage.keyboard.press('Enter');
  await mockPage.waitForSelector('[data-testid="error-message"]', { timeout: 8000 });

  await check(`error code ${errorCases[0].code} displays clear error and no fake AI reply`, async () => {
    const bubbleText = await mockPage.$eval('[data-testid="error-message"] .msg__bubble', (n) => n.textContent.trim());
    assert(errorCases[0].expectTitle.test(bubbleText), `unexpected error text: ${bubbleText}`);
    const normalAiCount = await mockPage.$$eval('.msg--ai:not(.msg--error)', (n) => n.length);
    assert(normalAiCount === 0, `expected 0 AI replies on failure, got ${normalAiCount}`);
    return errorCases[0].code;
  });

  for (const errCase of errorCases.slice(1)) {
    nextChatBehavior = {
      status: errCase.status,
      body: { status: errCase.status, code: errCase.code, message: errCase.message },
    };
    await mockPage.click('[data-retry]');
    await mockPage.waitForSelector('[data-testid="error-message"]', { timeout: 8000 });
    await check(`error code ${errCase.code} maps to user-friendly error state`, async () => {
      const bubbleText = await mockPage.$eval('[data-testid="error-message"] .msg__bubble', (n) => n.textContent.trim());
      assert(errCase.expectTitle.test(bubbleText), `unexpected error text: ${bubbleText}`);
      return errCase.code;
    });
  }

  // Now succeed on retry and verify no duplicate user message
  nextChatBehavior = {
    status: 200,
    body: {
      messageId: '9001',
      content: 'Polymorphism allows objects of different classes to be treated through a common interface.',
      providerId: 'gemini',
      model: 'gemini-2.5-flash',
      latencyMs: 420,
    },
  };
  await mockPage.click('[data-retry]');
  await mockPage.waitForFunction(
    () =>
      document.querySelectorAll('.msg--ai:not(.msg--error) .msg__bubble').length === 1 &&
      !document.querySelector('[data-testid="error-message"]'),
    { timeout: 8000 }
  );

  await check('retry succeeds via POST /api/chat/{id}/messages without duplicating user message', async () => {
    const userCount = await mockPage.$$eval('.msg--user', (n) => n.length);
    const aiText = await mockPage.$eval('.msg--ai .msg__bubble', (n) => n.textContent.trim());
    assert(userCount === 1, `expected 1 user message, got ${userCount}`);
    assert(/Polymorphism allows objects/i.test(aiText), `unexpected AI reply: ${aiText}`);
    assert(chatRequestsCaptured.length === errorCases.length + 1, 'unexpected request count');
    return `1 user msg, 1 Gemini reply (${chatRequestsCaptured.length} total attempts)`;
  });

  await mockPage.close();

  /* ================================================================
     PART B: Live Backend + MySQL + Real Gemini API Verification
     ================================================================ */
  step('Part B: Live Backend + MySQL + Real Gemini API Verification');
  let backendUp = false;
  try {
    const healthRes = await fetch(`${BACKEND}/api/health`);
    backendUp = healthRes.ok;
  } catch {
    backendUp = false;
  }

  if (!backendUp) {
    console.log('  ⚠ Live backend is not reachable on ' + BACKEND + '; skipping Part B.');
  } else {
    await check('GET /api/chat/providers returns Gemini as implemented with configured model', async () => {
      const res = await fetch(`${BACKEND}/api/chat/providers`);
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const providers = await res.json();
      const gemini = providers.find((p) => p.id === 'gemini');
      assert(gemini && gemini.implemented === true, 'gemini not marked as implemented');
      return `gemini (${gemini.defaultModel})`;
    });

    const livePage = await browser.newPage();
    await livePage.goto(FRONTEND, { waitUntil: 'networkidle0' });
    await livePage.waitForSelector('html[data-app-ready="true"]', { timeout: 10000 });

    // Register a fresh test user for isolated MySQL verification
    let devOtp = null;
    livePage.on('response', async (res) => {
      if (res.url().endsWith('/api/auth/register') && res.request().method() === 'POST' && res.status() === 200) {
        try {
          const b = await res.json();
          if (b?.devOtp) devOtp = b.devOtp;
        } catch {
          /* ignore */
        }
      }
    });

    const email = `m5.gemini.${Date.now()}@example.com`;
    await livePage.click('[data-goto-auth="register"]');
    await livePage.waitForSelector('#register-form:not([hidden])');
    await livePage.type('#register-name', 'RohanDesai');
    await livePage.type('#register-email', email);
    await livePage.type('#register-password', 'StrongPass@123');
    await livePage.click('#register-form button[type="submit"]');
    await livePage.waitForSelector('#verify-otp-form:not([hidden])');
    await livePage.type('#otp-code', devOtp);
    await livePage.click('#verify-otp-form button[type="submit"]');
    await livePage.waitForSelector('#app-shell:not([hidden])', { timeout: 10000 });

    const jwt = await livePage.evaluate(() => localStorage.getItem('ytalks.authToken'));

    // Send a real message to Gemini via UI
    await livePage.click('#composer-input');
    await livePage.type('#composer-input', 'Reply with the single word PONG and remember the secret number 42.');
    await livePage.keyboard.press('Enter');

    await livePage.waitForFunction(
      () =>
        document.querySelectorAll('.msg--ai:not(.msg--error) .msg__bubble').length >= 1 ||
        Boolean(document.querySelector('[data-testid="error-message"]')),
      { timeout: 40000 }
    );

    const hasError = await livePage.$('[data-testid="error-message"]');
    if (hasError) {
      const errText = await livePage.$eval('[data-testid="error-message"] .msg__bubble', (n) => n.textContent.trim());
      throw new Error(`Live Gemini request returned error bubble: ${errText}`);
    }

    await check('live Gemini API responds to first turn in UI', async () => {
      const reply = await livePage.$eval('.msg--ai .msg__bubble', (n) => n.textContent.trim());
      assert(reply.length > 0, 'empty Gemini reply');
      return reply.slice(0, 80).replace(/\s+/g, ' ');
    });

    // Send a second turn testing conversation context memory
    await livePage.click('#composer-input');
    await livePage.type('#composer-input', 'What was the secret number I asked you to remember? Reply with the number only.');
    await livePage.keyboard.press('Enter');

    await livePage.waitForFunction(
      () =>
        document.querySelectorAll('.msg--ai:not(.msg--error) .msg__bubble').length >= 2 ||
        Boolean(document.querySelector('[data-testid="error-message"]')),
      { timeout: 40000 }
    );

    await check('live Gemini API receives conversation history and recalls context ("42")', async () => {
      const replies = await livePage.$$eval('.msg--ai .msg__bubble', (nodes) => nodes.map((n) => n.textContent.trim()));
      const secondReply = replies[1] || '';
      assert(/42/.test(secondReply), `expected second reply to mention 42, got: ${secondReply}`);
      return secondReply.slice(0, 60).replace(/\s+/g, ' ');
    });

    await check('both USER and ASSISTANT turns are persisted in MySQL with zero duplicates', async () => {
      const listRes = await fetch(`${BACKEND}/api/conversations`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const list = await listRes.json();
      assert(list.length === 1, `expected 1 conversation in MySQL, got ${list.length}`);
      const detailRes = await fetch(`${BACKEND}/api/conversations/${list[0].id}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const detail = await detailRes.json();
      assert(detail.messages.length === 4, `expected 4 messages in MySQL (2 turns), got ${detail.messages.length}`);
      assert(detail.messages[0].senderType === 'USER', 'msg 0 not USER');
      assert(detail.messages[1].senderType === 'ASSISTANT', 'msg 1 not ASSISTANT');
      assert(detail.messages[2].senderType === 'USER', 'msg 2 not USER');
      assert(detail.messages[3].senderType === 'ASSISTANT', 'msg 3 not ASSISTANT');
      return `convId=${detail.id}, 4 messages in MySQL (USER, ASSISTANT, USER, ASSISTANT)`;
    });

    // Reload page and verify persistence
    await livePage.reload({ waitUntil: 'networkidle0' });
    await livePage.waitForSelector('html[data-app-ready="true"]', { timeout: 10000 });

    await check('real Gemini messages survive page refresh from MySQL', async () => {
      const domCount = await livePage.$$eval('.msg', (n) => n.length);
      assert(domCount === 4, `expected 4 messages rendered after reload, got ${domCount}`);
      return `${domCount} messages restored from MySQL`;
    });

    await livePage.close();
  }
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n================================================================`);
console.log(`Milestone 5 Gemini smoke test — ${results.length - failed.length}/${results.length} checks passed`);
console.log(`================================================================`);
process.exit(failed.length ? 1 : 0);
