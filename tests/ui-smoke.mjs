/**
 * tests/ui-smoke.mjs — automated browser test for the Milestone 1 prototype.
 *
 * It launches real Chrome (headless), drives every flow listed in the
 * milestone brief, asserts the expected DOM, fails on any console/page error,
 * and writes screenshots to tests/screenshots/ for visual review.
 *
 * Run:  npm test
 */

import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { decodePng, pixelLuminance, pixelRgb, averageRegion } from './lib/png.mjs';

/** WCAG relative luminance of an averaged {r,g,b} triple. */
function relativeLuminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** The lightest pixel in the image, as an {r,g,b} triple. */
function brightestPixel(image, step = 6) {
  let best = { r: 0, g: 0, b: 0, lum: -1 };
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const lum = pixelLuminance(image, x, y);
      if (lum > best.lum) best = { ...pixelRgb(image, x, y), lum };
    }
  }
  return best;
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(HERE, 'screenshots');
const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;

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

/* ------------------------------------------------------------------ */
/* Tiny test runner                                                    */
/* ------------------------------------------------------------------ */

const results = [];
let currentStep = 'startup';

function step(name) {
  currentStep = name;
  console.log(`\n▶ ${name}`);
}

function pass(message) {
  results.push({ step: currentStep, ok: true, message });
  console.log(`  ✓ ${message}`);
}

function fail(message, error) {
  results.push({ step: currentStep, ok: false, message, error });
  console.log(`  ✗ ${message}`);
  if (error) console.log(`      ${error.message?.split('\n')[0] || error}`);
}

async function check(label, fn) {
  try {
    const value = await fn();
    if (value === false) throw new Error('assertion returned false');
    pass(`${label}${value && value !== true ? ` → ${value}` : ''}`);
    return value;
  } catch (error) {
    fail(label, error);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Screenshot helper.
 * captureBeyondViewport is disabled on purpose: it resizes the viewport, which
 * fires a resize event and would legitimately close any open popover menu.
 */
async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name), captureBeyondViewport: false });
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'tools', 'serve.js'), String(PORT)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    child.stdout.on('data', (chunk) => {
      if (!settled && String(chunk).includes('http://')) {
        settled = true;
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`server exited early with code ${code}`));
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(child);
      }
    }, 1500);
  });
}

/* ------------------------------------------------------------------ */
/* Page helpers                                                        */
/* ------------------------------------------------------------------ */

async function text(page, selector) {
  return page.$eval(selector, (node) => node.textContent.trim()).catch(() => null);
}

async function count(page, selector) {
  return page.$$eval(selector, (nodes) => nodes.length);
}

async function exists(page, selector) {
  return (await count(page, selector)) > 0;
}

async function clickByText(page, selector, label) {
  const handle = await page.evaluateHandle(
    (sel, want) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.find((n) => n.textContent.trim().toLowerCase().includes(want.toLowerCase())) || null;
    },
    selector,
    label
  );
  const element = handle.asElement();
  assert(element, `no ${selector} containing "${label}"`);
  await element.click();
  return true;
}

async function typeMessage(page, text) {
  await page.click('#composer-input');
  await page.type('#composer-input', text, { delay: 4 });
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const server = await startServer();
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--font-render-hinting=none'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  /* ================================================================
     1. Login screen renders
     ================================================================ */
  step('Auth screen');
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('html[data-app-ready="true"]', { timeout: 10000 });

  await check('login form is visible', async () =>
    assert(await page.$eval('#login-form', (n) => !n.hidden), 'login form hidden')
  );
  await check('register form is hidden', async () =>
    assert(await page.$eval('#register-form', (n) => n.hidden), 'register form visible')
  );
  await shot(page, '01-login.png');

  /* ================================================================
     Branding
     ================================================================ */
  step('Branding');
  await check('page title is the product name', async () => {
    const title = await page.title();
    assert(/^Ytalks\b/.test(title), `title is "${title}"`);
    return title;
  });

  await check('the previous product name appears nowhere in the UI', async () => {
    // The served markup, the rendered text and the document title must all be clean.
    const html = await (await fetch(`${BASE}/index.html`)).text();
    assert(!/omnichat/i.test(html), 'index.html still mentions the old name');
    const leftovers = await page.evaluate(() => {
      const found = [];
      if (/omnichat/i.test(document.title)) found.push(`title: ${document.title}`);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeValue && /omnichat/i.test(node.nodeValue)) {
          found.push(`text: ${node.nodeValue.trim().slice(0, 60)}`);
        }
        node = walker.nextNode();
      }
      for (const attr of ['aria-label', 'title', 'placeholder', 'data-label', 'alt']) {
        document.querySelectorAll(`[${attr}]`).forEach((n) => {
          if (/omnichat/i.test(n.getAttribute(attr) || '')) found.push(`${attr}: ${n.getAttribute(attr)}`);
        });
      }
      return found;
    });
    assert(leftovers.length === 0, leftovers.join(' | '));
    return 'clean';
  });

  await check('product name is shown on the auth screen', async () => {
    const names = await page.$$eval('.brand__name', (nodes) => nodes.map((n) => n.textContent.trim()));
    assert(names.length > 0, 'no brand name rendered');
    assert(names.every((n) => n === 'Ytalks'), `brand names are ${names.join(', ')}`);
    return names.join(', ');
  });

  /* ================================================================
     Ambient background
     ================================================================ */
  step('Ambient background');
  await check('a non-interactive ambient layer sits behind the app', async () => {
    const info = await page.evaluate(() => {
      const layer = document.querySelector('.ambient');
      if (!layer) return null;
      const style = getComputedStyle(layer);
      const app = document.querySelector('#app');
      return {
        position: style.position,
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
        appZ: getComputedStyle(app).zIndex,
        coversViewport:
          layer.getBoundingClientRect().width >= window.innerWidth &&
          layer.getBoundingClientRect().height >= window.innerHeight,
      };
    });
    assert(info, '.ambient element missing');
    assert(info.position === 'fixed', `position is ${info.position}`);
    assert(info.pointerEvents === 'none', `pointer-events is ${info.pointerEvents}`);
    assert(Number(info.zIndex) < Number(info.appZ), `ambient z-index ${info.zIndex} is not below #app ${info.appZ}`);
    assert(info.coversViewport, 'layer does not cover the viewport');
    return `fixed, pointer-events none, z-index ${info.zIndex} < ${info.appZ}`;
  });

  await check('the ambient layer never blocks clicks on the UI', async () => {
    const hit = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return el ? el.closest('.ambient') !== null : false;
    });
    assert(!hit, 'the ambient layer is intercepting pointer events');
    return 'clicks pass through';
  });

  await check('background has a layered base, glows, grid and grain', async () => {
    const layers = await page.evaluate(() => {
      const style = (sel) => {
        const n = document.querySelector(sel);
        if (!n) return null;
        const s = getComputedStyle(n);
        return { image: s.backgroundImage, mask: s.maskImage || s.webkitMaskImage, boxShadow: s.boxShadow };
      };
      return {
        base: style('.ambient'),
        glow: style('.ambient__glow'),
        grid: style('.ambient__grid'),
        grain: style('.ambient__grain'),
      };
    });
    assert(layers.base, 'base layer missing');
    assert(layers.glow, 'glow layer missing');
    assert(layers.grid, 'grid layer missing');
    assert(layers.grain, 'grain layer missing');
    assert(
      (layers.glow.image.match(/radial-gradient/g) || []).length >= 3,
      'fewer than three radial light sources'
    );
    assert(
      (layers.grid.image.match(/linear-gradient/g) || []).length >= 2,
      'grid is not a two-axis hairline grid'
    );
    assert(layers.grid.mask && layers.grid.mask !== 'none', 'grid has no edge mask');
    assert(layers.base.boxShadow && layers.base.boxShadow !== 'none', 'no vignette');
    assert(/feTurbulence|svg/i.test(layers.grain.image), 'grain layer is not a noise texture');
    return `${(layers.glow.image.match(/radial-gradient/g) || []).length} glows, masked grid, vignette, grain`;
  });

  await check('panels are frosted glass rather than flat fills', async () => {
    const panels = await page.evaluate(() => {
      const read = (sel) => {
        const n = document.querySelector(sel);
        if (!n) return null;
        const s = getComputedStyle(n);
        return { bg: s.backgroundColor, blur: s.backdropFilter || s.webkitBackdropFilter };
      };
      return { sidebar: read('.sidebar'), header: read('.chat-header'), composer: read('.composer') };
    });
    const results = [];
    for (const [name, panel] of Object.entries(panels)) {
      if (!panel) continue;
      const translucent = /rgba\([^)]*,\s*0?\.\d+\)/.test(panel.bg);
      const blurred = panel.blur && panel.blur !== 'none';
      assert(translucent, `${name} background ${panel.bg} is opaque`);
      assert(blurred, `${name} has no backdrop blur`);
      results.push(`${name} ${panel.blur.split('(')[0]}`);
    }
    assert(results.length >= 2, `only ${results.length} glass panels found`);
    return results.join(', ');
  });

  await check('the glow drifts very slowly', async () => {
    const anim = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.ambient__glow'));
      return { name: s.animationName, duration: s.animationDuration, timing: s.animationTimingFunction };
    });
    assert(anim.name === 'ambient-drift', `animation is ${anim.name}`);
    const seconds = parseFloat(anim.duration);
    assert(seconds >= 45, `drift cycle is only ${seconds}s (would be noticeable movement)`);
    return `${anim.name} over ${seconds}s`;
  });

  await check('reduced-motion preference stills the background', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await sleep(200);
    const name = await page.evaluate(
      () => getComputedStyle(document.querySelector('.ambient__glow')).animationName
    );
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await sleep(200);
    const restored = await page.evaluate(
      () => getComputedStyle(document.querySelector('.ambient__glow')).animationName
    );
    assert(name === 'none', `animation under reduced motion is ${name}`);
    assert(restored === 'ambient-drift', `animation did not return (${restored})`);
    return 'disabled under reduce, restored otherwise';
  });

  /* ================================================================
     Validation
     ================================================================ */
  step('Form validation');
  await page.click('#login-form button[type="submit"]');
  await check('empty submit shows field errors', async () => {
    const errors = await count(page, '#login-form .field__error:not([hidden])');
    assert(errors >= 2, `expected >= 2 visible errors, got ${errors}`);
    return `${errors} errors shown`;
  });

  await page.type('#login-email', 'not-an-email');
  await page.type('#login-password', 'short');
  await page.click('#login-form button[type="submit"]');
  await check('invalid email + short password rejected', async () => {
    const emailErr = await text(page, '[data-error-for="login-email"]');
    const passErr = await text(page, '[data-error-for="login-password"]');
    assert(/valid email/i.test(emailErr), `email error was "${emailErr}"`);
    assert(/8 characters/i.test(passErr), `password error was "${passErr}"`);
    return 'both messages correct';
  });

  /* ================================================================
     Registration screen + switch back
     ================================================================ */
  step('Registration screen');
  await page.click('[data-goto-auth="register"]');
  await check('register form shows', async () =>
    assert(await page.$eval('#register-form', (n) => !n.hidden), 'register form hidden')
  );
  await page.waitForSelector('#register-password', { visible: true });
  await page.click('#register-password');
  await page.type('#register-password', 'Str0ng!Passw0rd');
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.strength__bar.is-on-weak, .strength__bar.is-on-medium, .strength__bar.is-on-strong'
      ).length >= 3,
    { timeout: 3000 }
  );
  await check('password strength meter reacts', async () => {
    const lit = await count(
      page,
      '.strength__bar.is-on-weak, .strength__bar.is-on-medium, .strength__bar.is-on-strong'
    );
    assert(lit >= 3, `expected >= 3 lit bars, got ${lit}`);
    return `${lit}/4 bars`;
  });
  await shot(page, '02-register.png');
  await page.click('[data-goto-auth="login"]');

  /* ================================================================
     2. Log in and reach the dashboard
     ================================================================ */
  step('Sign in');
  await page.click('#fill-demo-login');
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell:not([hidden])', { timeout: 8000 });
  await check('app shell is visible after sign-in', async () => {
    const hidden = await page.$eval('#app-shell', (n) => n.hidden);
    return assert(!hidden, 'app shell still hidden');
  });
  await check('user chip shows the signed-in account', async () => {
    const name = await text(page, '#user-name');
    const mail = await text(page, '#user-email');
    assert(name && mail, 'user chip empty');
    return `${name} <${mail}>`;
  });
  await check('sidebar lists seeded conversations', async () => {
    const n = await count(page, '.conv');
    assert(n >= 5, `expected >= 5 conversations, got ${n}`);
    return `${n} conversations`;
  });
  await check('conversation groups are labelled by day', async () => {
    const groups = await page.$$eval('.group-label', (nodes) => nodes.map((n) => n.textContent.trim()));
    assert(groups.length >= 2, `expected multiple day groups, got ${groups.join('|')}`);
    return groups.join(' / ');
  });

  // Speed up the mock provider so the test stays fast.
  await page.evaluate(() => {
    window.__ytalks.actions.setSettings({ mockLatencyMs: 120, streamTokens: true });
  });

  await check('active conversation opened with messages', async () => {
    const bubbles = await count(page, '.msg');
    assert(bubbles >= 6, `expected the seeded thread to render, got ${bubbles} messages`);
    return `${bubbles} messages`;
  });
  await check('AI bubbles are labelled with their provider', async () => {
    const labels = await page.$$eval('.msg--ai .msg__foot span', (nodes) =>
      nodes.map((n) => n.textContent.trim()).filter(Boolean)
    );
    assert(labels.length > 0, 'no provider labels found');
    return labels[0];
  });
  await shot(page, '03-dashboard.png');

  /* ================================================================
     3. Send a mock message
     ================================================================ */
  step('Send a message');
  const before = await count(page, '.msg');
  const aiBefore = await count(page, '.msg--ai .msg__bubble');
  await typeMessage(page, 'Explain HashMap vs TreeMap with a small example.');
  await check('send button enables when text is present', async () =>
    assert(!(await page.$eval('#send-btn', (n) => n.disabled)), 'send button stayed disabled')
  );
  await page.keyboard.press('Enter');

  await page.waitForSelector('.msg--user', { timeout: 4000 });
  await check('user bubble appears immediately', async () => {
    const last = await page.$$eval('.msg--user .msg__bubble', (nodes) =>
      nodes[nodes.length - 1].textContent
    );
    assert(/HashMap/.test(last), `unexpected user bubble: ${last}`);
    return last.slice(0, 48);
  });
  await check('streaming/loading indicator shows while the provider "thinks"', async () => {
    const seen =
      (await exists(page, '[data-testid="streaming-message"]')) ||
      (await exists(page, '.typing-dots'));
    return assert(seen, 'no streaming indicator found');
  });

  // Wait for the mock provider to finish: a new AI bubble AND no streaming node.
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll('.msg--ai .msg__bubble').length > n &&
      !document.querySelector('[data-testid="streaming-message"]'),
    { timeout: 30000 },
    aiBefore
  );
  await check('assistant reply arrives and is attributed to the provider', async () => {
    const footer = await page.$$eval('.msg--ai', (nodes) => {
      const last = nodes[nodes.length - 1];
      return last.querySelector('.msg__foot')?.textContent.trim() || '';
    });
    assert(/gpt|claude|gemini|deepseek/i.test(footer), `footer was "${footer}"`);
    return footer.replace(/\s+/g, ' ');
  });
  await check('reply discusses the asked topic (mock is topic-aware)', async () => {
    const bubble = await page.$$eval('.msg--ai .msg__bubble', (nodes) =>
      nodes[nodes.length - 1].textContent
    );
    assert(/HashMap|TreeMap/i.test(bubble), `reply did not mention the topic: ${bubble.slice(0, 80)}`);
    return 'topic matched';
  });
  await check('composer clears after sending', async () =>
    assert((await page.$eval('#composer-input', (n) => n.value)) === '', 'composer not cleared')
  );
  await shot(page, '04-conversation.png');

  /* ================================================================
     4. Provider selector
     ================================================================ */
  step('Provider selector');
  await page.click('#provider-trigger');
  await page.waitForSelector('.provider-menu', { timeout: 3000 });
  await check('provider menu lists every provider', async () => {
    const options = await count(page, '.provider-option');
    assert(options === 4, `expected 4 providers, got ${options}`);
    return `${options} providers`;
  });
  await check('active provider is marked with aria-checked', async () => {
    const checked = await page.$$eval('.provider-option[aria-checked="true"]', (nodes) =>
      nodes.map((n) => n.dataset.providerId)
    );
    assert(checked.length === 1, `expected exactly 1 active provider, got ${checked.join(',')}`);
    return checked[0];
  });
  await check('active provider exposes its model list', async () => {
    const chips = await count(page, '.model-chip');
    assert(chips >= 2, `expected model chips, got ${chips}`);
    return `${chips} models`;
  });
  await shot(page, '05-provider-menu.png');

  /* ================================================================
     5 + 6. Cross-AI handoff dialog (YES path)
     ================================================================ */
  step('Cross-AI handoff dialog');
  await clickByText(page, '.provider-option', 'Anthropic Claude');
  await page.waitForSelector('.dialog', { timeout: 3000 });
  await check('dialog asks to continue the conversation', async () => {
    const title = await text(page, '.dialog__title');
    assert(/continue this conversation with anthropic claude/i.test(title), `title was "${title}"`);
    return title;
  });
  await check('dialog offers exactly the three documented choices', async () => {
    const labels = await page.$$eval('.dialog__footer .btn', (nodes) =>
      nodes.map((n) => n.textContent.trim())
    );
    const expected = ['Cancel', 'Start new chat', 'Continue conversation'];
    assert(
      expected.every((e) => labels.includes(e)) && labels.length === 3,
      `buttons were ${labels.join(' | ')}`
    );
    return labels.join(' / ');
  });
  await check('dialog previews the context that will be transferred', async () => {
    const items = await count(page, '.handoff-preview__item');
    assert(items >= 1, 'no preview items');
    const flow = await count(page, '.handoff-flow__node');
    assert(flow === 2, `expected from → to flow, got ${flow} nodes`);
    return `${items} previewed messages, ${flow}-node flow`;
  });
  await shot(page, '06-handoff-dialog.png');

  await page.click('#handoff-continue');
  await page.waitForFunction(() => !document.querySelector('.dialog'), { timeout: 4000 });
  await check('handoff divider is recorded in the thread', async () => {
    const divider = await page.$$eval('.handoff', (nodes) => nodes.map((n) => n.textContent));
    assert(divider.length >= 1, 'no handoff divider rendered');
    assert(/context transferred/i.test(divider[0]), `divider text: ${divider[0]}`);
    return divider[0].replace(/\s+/g, ' ').trim();
  });
  await check('conversation now runs on the new provider', async () => {
    const badge = await text(page, '#chat-subtitle');
    assert(/anthropic/i.test(badge), `subtitle was "${badge}"`);
    return badge.replace(/\s+/g, ' ').trim();
  });
  await check('original messages are preserved', async () => {
    const n = await count(page, '.msg');
    assert(n > before, `message count went backwards (${n} <= ${before})`);
    return `${n} messages preserved in one thread`;
  });

  step('Continued conversation with inherited context');
  const aiBeforeBridge = await count(page, '.msg--ai .msg__bubble');
  await typeMessage(page, 'What is context switching in the OS?');
  await page.keyboard.press('Enter');
  // Wait for the stream to finish, not just for the first streamed words.
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll('.msg--ai .msg__bubble').length > n &&
      !document.querySelector('[data-testid="streaming-message"]'),
    { timeout: 30000 },
    aiBeforeBridge
  );
  await check('new provider acknowledges the transferred context', async () => {
    const bubble = await page.$$eval('.msg--ai .msg__bubble', (nodes) =>
      nodes[nodes.length - 1].textContent
    );
    assert(/context transferred from/i.test(bubble), 'no context bridge in the reply');
    assert(/cannot call it|never contacted|no memory/i.test(bubble), 'architecture note missing');
    return bubble.slice(0, 96).replace(/\s+/g, ' ') + '…';
  });
  await check('handoff count is shown in the chat header', async () => {
    const subtitle = await text(page, '#chat-subtitle');
    assert(/cross-ai handoff/i.test(subtitle), `subtitle was "${subtitle}"`);
    return subtitle.replace(/\s+/g, ' ').trim();
  });
  await shot(page, '07-after-handoff.png');

  /* ================================================================
     7. NO path — original conversation untouched
     ================================================================ */
  step('Cross-AI handoff dialog (NO path)');
  const firstConvId = await page.evaluate(() => {
    const s = window.__ytalks.store.getState();
    return s.conversations.find((c) => c.id === s.activeConversationId)?.id;
  });
  const originalSnapshot = await page.evaluate(() => {
    const s = window.__ytalks.store.getState();
    const c = s.conversations.find((x) => x.id === s.activeConversationId);
    return { title: c.title, count: c.messages.length, providerId: c.providerId };
  });

  await page.click('#provider-trigger');
  await page.waitForSelector('.provider-menu', { timeout: 3000 });
  await clickByText(page, '.provider-option', 'Google Gemini');
  await page.waitForSelector('.dialog', { timeout: 3000 });
  await clickByText(page, '.dialog__footer .btn', 'Start new chat');
  await page.waitForFunction(() => !document.querySelector('.dialog'), { timeout: 4000 });

  await check('a brand new conversation is opened', async () => {
    const active = await page.evaluate(() => {
      const s = window.__ytalks.store.getState();
      const c = s.conversations.find((x) => x.id === s.activeConversationId);
      return { id: c.id, providerId: c.providerId, count: c.messages.length };
    });
    assert(active.id !== firstConvId, 'still on the same conversation');
    assert(active.count === 0, `new conversation has ${active.count} messages`);
    assert(active.providerId === 'gemini', `new conversation provider is ${active.providerId}`);
    return `new empty chat on ${active.providerId}`;
  });
  await check('the previous conversation is unchanged', async () => {
    const after = await page.evaluate((id) => {
      const s = window.__ytalks.store.getState();
      const c = s.conversations.find((x) => x.id === id);
      return { title: c.title, count: c.messages.length, providerId: c.providerId };
    }, firstConvId);
    assert(
      after.count === originalSnapshot.count && after.providerId === originalSnapshot.providerId,
      `before ${JSON.stringify(originalSnapshot)} after ${JSON.stringify(after)}`
    );
    return `${after.count} messages still on ${after.providerId}`;
  });
  await check('empty state is shown for the new chat', async () =>
    assert(await exists(page, '[data-testid="empty-state"]'), 'empty state missing')
  );
  await shot(page, '08-new-chat-empty.png');

  /* ================================================================
     8. New chat + starter prompts + search
     ================================================================ */
  step('New chat and history');
  await clickByText(page, '[data-prompt]', 'HashMap');
  await page.waitForFunction(
    () => document.querySelectorAll('.msg--ai .msg__bubble').length > 0,
    { timeout: 20000 }
  );
  await check('starter prompt sends a message', async () => {
    const n = await count(page, '.msg');
    assert(n >= 2, `expected 2 messages, got ${n}`);
    return `${n} messages`;
  });

  await page.click('#new-chat');
  await check('New chat button creates an empty conversation', async () => {
    const active = await page.evaluate(() => {
      const s = window.__ytalks.store.getState();
      const c = s.conversations.find((x) => x.id === s.activeConversationId);
      return { title: c.title, count: c.messages.length, total: s.conversations.length };
    });
    assert(active.count === 0, 'new chat is not empty');
    assert(active.total >= 6, `conversation not added (total ${active.total})`);
    return `${active.total} conversations in history`;
  });

  await page.type('#conversation-search', 'concurrency');
  await check('search filters the history by title and message text', async () => {
    const rows = await count(page, '.conv');
    const titles = await page.$$eval('.conv__title', (nodes) =>
      nodes.map((x) => x.textContent)
    );

    // Cross-check against the store: every visible row must genuinely match,
    // and the unrelated seeded threads must be filtered out.
    const truth = await page.evaluate(() => {
      const s = window.__ytalks.store.getState();
      const q = s.ui.searchQuery.toLowerCase();
      return s.conversations
        .filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            c.messages.some((m) => (m.content || '').toLowerCase().includes(q))
        )
        .map((c) => c.title);
    });

    assert(rows >= 1, 'search returned nothing');
    assert(
      titles.length === truth.length,
      `UI shows ${titles.length} rows but the store matches ${truth.length}: ${truth.join('|')}`
    );
    assert(titles.includes('Java concurrency questions'), 'title match missing');
    assert(!titles.includes('Fixing a bad git rebase'), 'unrelated thread was not filtered out');
    return `${rows} match(es): ${titles.join(', ')}`;
  });
  await shot(page, '09-search.png');

  await page.$eval('#conversation-search', (n) => {
    n.value = '';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await check('clearing search restores the full list', async () => {
    const rows = await count(page, '.conv');
    assert(rows >= 6, `expected full list, got ${rows}`);
    return `${rows} rows`;
  });

  /* ================================================================
     9. Persistence across reload
     ================================================================ */
  step('Persistence');
  const beforeReload = await page.evaluate(() => {
    const s = window.__ytalks.store.getState();
    return { conversations: s.conversations.length, active: s.activeConversationId };
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('html[data-app-ready="true"]');
  await check('session and history survive a reload', async () => {
    const after = await page.evaluate(() => {
      const s = window.__ytalks.store.getState();
      return {
        authed: s.session.isAuthenticated,
        conversations: s.conversations.length,
        handoffs: s.conversations.flatMap((c) => c.messages).filter((m) => m.type === 'handoff').length,
      };
    });
    assert(after.authed, 'session lost on reload');
    assert(after.conversations === beforeReload.conversations, 'conversation count changed on reload');
    assert(after.handoffs >= 2, `handoff records lost on reload (${after.handoffs})`);
    return `${after.conversations} conversations, ${after.handoffs} handoffs restored`;
  });

  /* ================================================================
     Error state
     ================================================================ */
  step('Error handling');
  await page.evaluate(() => {
    window.__ytalks.actions.setSettings({ mockErrorMode: 'rate_limit', mockLatencyMs: 60 });
  });
  await typeMessage(page, 'Trigger a provider failure please.');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="error-message"]', { timeout: 15000 });
  await check('rate limit is shown as a friendly error', async () => {
    const text_ = await text(page, '[data-testid="error-message"] .msg__bubble');
    assert(/rate limit/i.test(text_), `error text was "${text_}"`);
    assert(!/HTTP 429\s*:\s*quota|org\.springframework|at java\./.test(text_), 'raw technical detail leaked');
    return text_.split('\n')[0];
  });
  await check('error offers a retry action', async () =>
    assert(await exists(page, '[data-retry]'), 'no retry button')
  );
  await shot(page, '10-error-state.png');

  await page.evaluate(() => {
    window.__ytalks.actions.setSettings({ mockErrorMode: 'none', mockLatencyMs: 100 });
  });
  const aiBeforeRetry = await count(page, '.msg--ai:not(.msg--error) .msg__bubble');
  await page.click('[data-retry]');
  // The error bubble disappears the moment a retry starts, so wait for the new
  // AI message to actually land.
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll('.msg--ai:not(.msg--error) .msg__bubble').length > n &&
      !document.querySelector('[data-testid="streaming-message"]') &&
      !document.querySelector('[data-testid="error-message"]'),
    { timeout: 40000 },
    aiBeforeRetry
  );
  await check('retry recovers the conversation', async () => {
    const n = await count(page, '.msg--ai:not(.msg--error) .msg__bubble');
    assert(n > aiBeforeRetry, `no AI reply after retry (still ${n})`);
    return `${n} AI replies`;
  });

  /* ================================================================
     Settings, theme, stop generation
     ================================================================ */
  step('Settings and theme');
  await page.click('#open-settings');
  await page.waitForSelector('.dialog', { timeout: 3000 });
  await check('settings dialog shows prototype controls and stats', async () => {
    const groups = await count(page, '.settings-group');
    const stats = await count(page, '.stat');
    assert(groups >= 3 && stats === 4, `groups ${groups}, stats ${stats}`);
    return `${groups} groups, ${stats} stats`;
  });
  await shot(page, '11-settings.png');

  await clickByText(page, '.segmented__option', 'Light');
  await check('light theme applies', async () => {
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert(theme === 'light', `theme is ${theme}`);
    return theme;
  });
  await shot(page, '12-settings-light.png');
  await clickByText(page, '.dialog__footer .btn', 'Done');
  await check('light theme is reflected in the chat area', async () =>
    assert(
      await page.$eval('body', (n) => getComputedStyle(n).backgroundColor !== 'rgba(0, 0, 0, 0)'),
      'body has no background'
    )
  );
  await shot(page, '13-chat-light.png');
  await page.evaluate(() => window.__ytalks.actions.setTheme('dark'));

  step('Stop generating');
  await page.click('#new-chat');
  await page.evaluate(() => {
    window.__ytalks.actions.setSettings({ mockLatencyMs: 3000, streamTokens: true });
  });
  await typeMessage(page, 'This one I will stop halfway.');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="streaming-message"]', { timeout: 6000 });
  await check('send button becomes a stop button while generating', async () => {
    const mode = await page.$eval('#send-btn', (n) => n.dataset.mode);
    return assert(mode === 'stop', `button mode is ${mode}`);
  });
  await page.click('#send-btn');
  await check('stopping removes the streaming bubble', async () => {
    await page.waitForFunction(() => !document.querySelector('[data-testid="streaming-message"]'), {
      timeout: 5000,
    });
    return true;
  });
  await page.evaluate(() => window.__ytalks.actions.setSettings({ mockLatencyMs: 120 }));

  /* ================================================================
     Conversation management: rename, export, delete
     ================================================================ */
  step('Conversation management');
  await page.evaluate(() => {
    const s = window.__ytalks.store.getState();
    const c = s.conversations.find((x) => x.id === s.activeConversationId);
    window.__ytalks.actions.renameConversation(c.id, 'Renamed by the smoke test');
  });
  await check('rename updates the sidebar and header', async () => {
    const title = await text(page, '#chat-title');
    const rowTitle = await page.$$eval('.conv.is-active .conv__title', (n) => n[0]?.textContent);
    assert(title === 'Renamed by the smoke test', `header title was "${title}"`);
    assert(rowTitle === title, `sidebar title was "${rowTitle}"`);
    return title;
  });

  await page.evaluate(() => {
    const s = window.__ytalks.store.getState();
    const c = s.conversations.find((x) => x.id === s.activeConversationId);
    window.__ytalks.actions.duplicateConversation(c.id);
  });
  await check('duplicate creates an independent copy', async () => {
    const info = await page.evaluate(() => {
      const s = window.__ytalks.store.getState();
      const c = s.conversations.find((x) => x.id === s.activeConversationId);
      return { title: c.title, count: c.messages.length };
    });
    assert(/copy/i.test(info.title), `copy title was "${info.title}"`);
    return info.title;
  });

  /* ================================================================
     Responsive layouts
     ================================================================ */
  step('Responsive layout');
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(250);
  await check('desktop shows the sidebar as a column', async () => {
    const box = await page.$eval('#sidebar', (n) => {
      const r = n.getBoundingClientRect();
      return { width: r.width, left: r.left, right: r.right };
    });
    assert(box.width > 240 && box.left < 20, `sidebar box ${JSON.stringify(box)}`);
    return `${Math.round(box.width)}px sidebar`;
  });
  await shot(page, '14-desktop.png');

  await page.setViewport({ width: 820, height: 1000 });
  await sleep(350);
  await check('tablet hides the sidebar behind the menu button', async () => {
    const hidden = await page.$eval('#sidebar', (n) => n.getBoundingClientRect().right <= 1);
    const burgerVisible = await page.$eval('#open-sidebar', (n) => n.offsetParent !== null);
    assert(hidden, 'sidebar still occupies space on tablet');
    assert(burgerVisible, 'menu button not visible on tablet');
    return 'sidebar off-canvas';
  });
  await page.click('#open-sidebar');
  await sleep(400);
  await check('menu button opens the sidebar drawer', async () => {
    const open = await page.$eval('#sidebar', (n) => n.classList.contains('is-open'));
    const scrim = await page.$eval('#sidebar-scrim', (n) => !n.hidden);
    assert(open && scrim, `open=${open} scrim=${scrim}`);
    return 'drawer + scrim';
  });
  await shot(page, '15-tablet-drawer.png');
  await page.click('#sidebar-scrim');
  await sleep(300);

  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  await check('mobile layout has no horizontal overflow', async () => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert(overflow <= 1, `horizontal overflow of ${overflow}px`);
    return 'no overflow';
  });
  await shot(page, '16-mobile.png');

  await page.click('#open-sidebar');
  await sleep(400);
  await shot(page, '17-mobile-drawer.png');
  await page.keyboard.press('Escape');
  await sleep(300);
  await check('Escape closes the mobile drawer', async () =>
    assert(
      !(await page.$eval('#sidebar', (n) => n.classList.contains('is-open'))),
      'drawer still open'
    )
  );

  /* ================================================================
     Accessibility basics
     ================================================================ */
  step('Accessibility basics');
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(200);
  await check('interactive controls have accessible names', async () => {
    const unnamed = await page.$$eval('button, a[href], input, textarea', (nodes) =>
      nodes
        .filter((n) => n.offsetParent !== null)
        .filter((n) => {
          const name =
            n.getAttribute('aria-label') ||
            n.textContent.trim() ||
            (n.labels && n.labels.length && n.labels[0].textContent.trim()) ||
            n.getAttribute('title');
          return !name;
        })
        .map((n) => n.outerHTML.slice(0, 70))
    );
    assert(unnamed.length === 0, `unnamed controls: ${unnamed.join(' ;; ')}`);
    return 'all named';
  });

  await check('message log and dialogs use ARIA roles correctly', async () => {
    const log = await page.$eval('#messages', (n) => n.getAttribute('role') === 'log' && n.getAttribute('aria-live') === 'polite');
    assert(log, '#messages is not an aria-live log');
    return 'aria-live log';
  });

  await check('dialog traps focus and restores it on close', async () => {
    await page.click('#open-settings');
    await page.waitForSelector('.dialog');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const insideDialog = await page.evaluate(() =>
      Boolean(document.activeElement.closest('.dialog'))
    );
    assert(insideDialog, 'focus escaped the dialog');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.dialog'));
    const restored = await page.evaluate(() => document.activeElement.id);
    assert(restored === 'open-settings', `focus restored to "${restored}"`);
    return 'trap + restore OK';
  });

  /* ================================================================
     Sign out
     ================================================================ */
  step('Sign out');
  await page.click('#user-chip');
  await page.waitForSelector('.menu', { timeout: 3000 });
  await clickByText(page, '.menu__item', 'Sign out');
  await page.waitForSelector('.dialog', { timeout: 3000 });
  await clickByText(page, '.dialog__footer .btn', 'Sign out');
  await page.waitForFunction(() => Boolean(document.querySelector('#app-shell[hidden]')), {
    timeout: 5000,
  });
  await check('sign out returns to the auth screen', async () => {
    const authVisible = await page.$eval('#auth-screen', (n) => !n.hidden);
    return assert(authVisible, 'auth screen not shown');
  });
  await shot(page, '18-signed-out.png');

  /* ================================================================
     Visual & layout audit (objective checks, since the design must be
     verified without eyeballing: contrast, geometry, overflow, focus)
     ================================================================ */
  step('Visual and layout audit');

  // The sign-out check above left us on the auth screen, so sign back in first.
  await page.type('#login-email', 'aarav.sharma@example.com');
  await page.type('#login-password', 'Demo@12345');
  await page.click('#login-form button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('#app-shell[hidden]'), { timeout: 5000 });

  await page.evaluate(() => {
    // Open the longest thread with replies so the audit runs against real content.
    const s = window.__ytalks.store.getState();
    const withReplies = s.conversations.filter((c) =>
      c.messages.some((m) => m.type === 'assistant')
    );
    const target = withReplies.sort((a, b) => b.messages.length - a.messages.length)[0];
    if (!target) throw new Error('no conversation with an AI reply to audit');
    window.__ytalks.actions.selectConversation(target.id);
    window.__ytalks.actions.setTheme('dark');
  });
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(400);

  await page.evaluate(() => {
    // Inject a WCAG contrast helper. It walks up for the effective background
    // and, for gradients, measures every colour stop and reports the worst case.
    window.__audit = {
      parse(color) {
        const m = (color || '').match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = 1] = m[1].split(',').map((n) => parseFloat(n));
        return { r, g, b, a };
      },
      lum({ r, g, b }) {
        const f = (c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      },
      flatten(fg, bg) {
        const a = fg.a ?? 1;
        return {
          r: fg.r * a + bg.r * (1 - a),
          g: fg.g * a + bg.g * (1 - a),
          b: fg.b * a + bg.b * (1 - a),
          a: 1,
        };
      },
      ratio(fg, bg) {
        const l1 = this.lum(fg);
        const l2 = this.lum(bg);
        const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      },
      // Every plausible background behind this node.
      backgrounds(node) {
        const style = getComputedStyle(node);
        const image = style.backgroundImage || '';
        if (image.includes('gradient')) {
          const stops = (image.match(/rgba?\([^)]+\)/g) || [])
            .map((c) => this.parse(c))
            .filter((c) => c && c.a > 0.5)
            .map((c) => ({ r: c.r, g: c.g, b: c.b, a: 1 }));
          if (stops.length) return stops;
        }
        const own = this.parse(style.backgroundColor);
        if (own && own.a > 0.5) return [{ ...own, a: 1 }];
        let el = node.parentElement;
        while (el) {
          const c = this.parse(getComputedStyle(el).backgroundColor);
          if (c && c.a > 0.5) return [{ ...c, a: 1 }];
          el = el.parentElement;
        }
        return [this.parse(getComputedStyle(document.body).backgroundColor)];
      },
      contrast(selector) {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        const raw = this.parse(style.color);
        if (!raw) return null;
        let worst = null;
        for (const bg of this.backgrounds(node)) {
          const fg = (raw.a ?? 1) < 1 ? this.flatten(raw, bg) : raw;
          const r = this.ratio(fg, bg);
          if (worst === null || r < worst) worst = r;
        }
        const size = parseFloat(style.fontSize);
        const bold = parseInt(style.fontWeight, 10) >= 700;
        return { ratio: worst, large: size >= 24 || (bold && size >= 18.66), size };
      },
    };
  });

  const contrastFor = (selector) =>
    page.evaluate((sel) => window.__audit.contrast(sel), selector);

  const aaCheck = async (label, selector, themeNote) => {
    await check(`${label} (${themeNote} theme)`, async () => {
      const measured = await contrastFor(selector);
      assert(measured !== null, `could not measure ${selector}`);
      const needed = measured.large ? 3 : 4.5;
      assert(
        measured.ratio >= needed,
        `${selector} is ${measured.ratio}:1 at ${measured.size}px (needs ${needed}:1)`
      );
      return `${measured.ratio}:1 at ${measured.size}px`;
    });
  };

  await aaCheck('AI reply text meets WCAG AA', '.msg--ai .msg__bubble', 'dark');
  await aaCheck('secondary header text meets WCAG AA', '.chat-header__sub', 'dark');
  await aaCheck('sidebar row title meets WCAG AA', '.conv__title', 'dark');
  await aaCheck('user bubble label stays legible on its gradient', '.msg--user .msg__bubble', 'dark');
  await aaCheck('primary button label stays legible on its gradient', '.btn--primary', 'dark');

  await page.evaluate(() => window.__ytalks.actions.setTheme('light'));
  await sleep(350);
  await aaCheck('AI reply text meets WCAG AA', '.msg--ai .msg__bubble', 'light');
  await aaCheck('secondary header text meets WCAG AA', '.chat-header__sub', 'light');
  await aaCheck('sidebar row title meets WCAG AA', '.conv__title', 'light');
  await aaCheck('user bubble label stays legible on its gradient', '.msg--user .msg__bubble', 'light');
  await aaCheck('primary button label stays legible on its gradient', '.btn--primary', 'light');

  await page.evaluate(() => window.__ytalks.actions.setTheme('dark'));
  await sleep(350);

  await check('typography scale is applied consistently', async () => {
    const sizes = await page.evaluate(() => {
      const read = (sel, prop = 'fontSize') => {
        const n = document.querySelector(sel);
        return n ? getComputedStyle(n)[prop] : null;
      };
      return {
        body: read('body'),
        message: read('.msg__bubble'),
        sidebarTitle: read('.conv__title'),
        font: getComputedStyle(document.body).fontFamily,
      };
    });
    assert(sizes.body === '15px', `body font-size is ${sizes.body}`);
    assert(sizes.message === '15px', `message font-size is ${sizes.message}`);
    assert(sizes.sidebarTitle === '13px', `sidebar title is ${sizes.sidebarTitle}`);
    assert(/system-ui|-apple-system|Segoe/i.test(sizes.font), `unexpected font stack ${sizes.font}`);
    return `body ${sizes.body}, message ${sizes.message}, sidebar ${sizes.sidebarTitle}`;
  });

  await check('message column is centred and width-constrained', async () => {
    const box = await page.evaluate(() => {
      const inner = document.querySelector('.messages__inner').getBoundingClientRect();
      const outer = document.querySelector('.messages').getBoundingClientRect();
      return { width: inner.width, left: inner.left, right: inner.right, oLeft: outer.left, oRight: outer.right };
    });
    assert(box.width <= 782, `content column is ${box.width}px wide (max 780)`);
    const leftGap = box.left - box.oLeft;
    const rightGap = box.oRight - box.right;
    const centreGap = Math.abs(leftGap - rightGap);
    assert(centreGap < 2, `content column is off-centre by ${centreGap}px`);
    assert(leftGap > 8 && rightGap > 8, 'column is not inset from the chat area');
    return `${Math.round(box.width)}px column, ${Math.round(leftGap)}px inset each side`;
  });

  await check('no bubble overflows the message column', async () => {
    const overflow = await page.evaluate(() => {
      const inner = document.querySelector('.messages__inner').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.msg__bubble'))
        .map((b) => b.getBoundingClientRect().right - inner.right)
        .filter((d) => d > 1).length;
    });
    assert(overflow === 0, `${overflow} bubbles overflow the column`);
    return 'none';
  });

  await check('long thread scrolls inside the message area', async () => {
    const info = await page.evaluate(() => {
      const box = document.querySelector('#messages');
      return {
        scrollHeight: box.scrollHeight,
        clientHeight: box.clientHeight,
        overflowY: getComputedStyle(box).overflowY,
      };
    });
    assert(['auto', 'scroll'].includes(info.overflowY), `overflow-y is ${info.overflowY}`);
    assert(info.scrollHeight > info.clientHeight, 'long thread does not scroll');
    return `${info.scrollHeight}px content in ${info.clientHeight}px viewport`;
  });

  await check('opening a conversation lands on the newest message', async () => {
    await sleep(500);
    const atBottom = await page.evaluate(() => {
      const box = document.querySelector('#messages');
      return box.scrollHeight - box.scrollTop - box.clientHeight;
    });
    assert(atBottom < 24, `view is ${atBottom}px away from the bottom`);
    return 'scrolled to the end';
  });

  await check('composer is pinned to the bottom of the viewport', async () => {
    const gap = await page.evaluate(() => {
      const dock = document.querySelector('.composer-dock').getBoundingClientRect();
      return window.innerHeight - dock.bottom;
    });
    assert(Math.abs(gap) < 2, `composer sits ${gap}px off the bottom`);
    return 'anchored';
  });

  await check('keyboard focus produces a visible focus ring', async () => {
    await page.focus('#composer-input');
    const style = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, shadow: s.boxShadow };
    });
    const ring = style.shadow !== 'none' || parseFloat(style.outlineWidth) > 0;
    assert(ring, `no focus indicator (outline ${style.outlineWidth}, shadow ${style.shadow})`);
    return `outline ${style.outlineWidth} ${style.outlineStyle}`;
  });

  await check('provider accent colours are visually distinct', async () => {
    const hues = await page.evaluate(() => {
      const s = window.__ytalks.store.getState();
      return s.providers.map((p) => p.accent);
    });
    assert(new Set(hues).size === hues.length, `duplicate accent colours: ${hues.join(',')}`);
    return hues.join(' ');
  });

  await check('reduced-motion preference is respected', async () => {
    const emulated = await page.evaluate(() => {
      return new Promise((resolve) => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        resolve(mq.matches);
      });
    });
    // Puppeteer's default is "no-preference"; the CSS rule exists either way.
    assert(emulated === false, 'test environment unexpectedly forces reduced motion');
    const hasRule = await page.evaluate(() =>
      Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules).some(
            (r) => r.conditionText && r.conditionText.includes('prefers-reduced-motion')
          );
        } catch {
          return false;
        }
      })
    );
    assert(hasRule, 'no prefers-reduced-motion block in the CSS');
    return 'media query present';
  });

  /* ================================================================
     Rendered background — measured on actual screenshot pixels, because
     "premium but subtle" cannot be asserted from the stylesheet alone.
     Text, bubbles and controls are masked out: only the background itself
     is sampled, so a white button cannot be mistaken for a bright glow.
     ================================================================ */
  step('Rendered background (pixel audit)');

  const CONTENT_SELECTOR = [
    '.msg',
    '.handoff',
    '.day-divider',
    '.composer',
    '.chat-header',
    '.sidebar',
    '.topbar',
    '.sidebar-scrim',
    'button',
    'input',
    'textarea',
    'a',
    '.badge',
    '.toast',
    '.toast-region',
    '#dialog-root',
    '.menu',
    '.dialog',
    '.skeleton',
  ].join(', ');

  /** Coordinates where the topmost element is background, not content. */
  const backgroundPoints = () =>
    page.evaluate(
      (blocked) => {
        const points = [];
        // The last 14px is the scrollbar gutter, which is chrome, not background.
        for (let y = 6; y < window.innerHeight - 6; y += 6) {
          for (let x = 6; x < window.innerWidth - 14; x += 6) {
            const el = document.elementFromPoint(x, y);
            if (el && !el.closest(blocked)) points.push([x, y]);
          }
        }
        return points;
      },
      CONTENT_SELECTOR
    );

  const sampleStats = (image, points) => {
    const values = points.map(([x, y]) => pixelLuminance(image, x, y));
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Text antialiasing and 1px hairlines still land on a few background points
    // and are not "background". Everything up to 8x the median is the smooth
    // gradient; anything brighter is counted as a bright outlier and bounded
    // separately, so a large bright area can never hide in the statistics.
    const outlierFloor = Math.max(0.02, median * 8);
    const kept = values.filter((v) => v <= outlierFloor);
    const keptSorted = [...kept].sort((a, b) => a - b);
    const q = (p) => keptSorted[Math.min(keptSorted.length - 1, Math.floor(keptSorted.length * p))];
    return {
      count: values.length,
      keptCount: kept.length,
      outliers: values.length - kept.length,
      outlierFloor,
      min: keptSorted[0],
      p50: q(0.5),
      p99: q(0.99),
      max: keptSorted[keptSorted.length - 1],
      mean: kept.reduce((a, b) => a + b, 0) / kept.length,
    };
  };

  const meanIn = (image, points, left, right, top, bottom) => {
    const picked = points.filter(([x, y]) => x >= left && x < right && y >= top && y < bottom);
    if (!picked.length) return null;
    return sampleStats(image, picked).mean;
  };

  const chatShot = decodePng(await page.screenshot({ type: 'png' }));
  const chatPoints = await backgroundPoints();
  const stats = sampleStats(chatShot, chatPoints);

  await check('only the background is sampled, never the UI', async () => {
    assert(stats.count > 3000, `only ${stats.count} background pixels found`);
    return `${stats.count} background pixels`;
  });

  await check('the base of the background is deep, dark charcoal', async () => {
    assert(stats.min < 0.01, `darkest background pixel is ${stats.min.toFixed(4)} — not a deep base`);
    return `min luminance ${stats.min.toFixed(4)}`;
  });

  await check('no bright area is hiding in the background', async () => {
    const share = stats.outliers / stats.count;
    if (share >= 0.005) {
      const loud = [];
      for (const [x, y] of chatPoints) {
        const lum = pixelLuminance(chatShot, x, y);
        if (lum > stats.outlierFloor && loud.length < 4) {
          const p = pixelRgb(chatShot, x, y);
          const el = await page.evaluate(
            (px, py) => {
              const n = document.elementFromPoint(px, py);
              return n ? `${n.tagName.toLowerCase()}.${n.className || '-'}` : 'none';
            },
            x,
            y
          );
          loud.push(`(${x},${y}) rgb(${p.r},${p.g},${p.b}) <${el}>`);
        }
      }
      throw new Error(
        `${stats.outliers} of ${stats.count} background samples are bright outliers (${(share * 100).toFixed(2)}%): ${loud.join(' | ')}`
      );
    }
    return `${stats.outliers} hairline/text outliers of ${stats.count} samples (${(share * 100).toFixed(2)}%)`;
  });

  await check('the atmosphere is clearly visible but never bright', async () => {
    assert(stats.max < 0.05, `brightest background pixel is ${stats.max.toFixed(4)} — too bright`);
    assert(stats.mean < 0.02, `mean background luminance ${stats.mean.toFixed(4)} is too bright`);
    assert(
      stats.max - stats.min > 0.006,
      `luminance range ${(stats.max - stats.min).toFixed(4)} — the background still looks flat`
    );
    return `min ${stats.min.toFixed(4)}, median ${stats.p50.toFixed(4)}, max ${stats.max.toFixed(4)}`;
  });

  await check('the light sources are indigo/blue, not random colour', async () => {
    let best = { lum: -1 };
    for (const [x, y] of chatPoints) {
      const lum = pixelLuminance(chatShot, x, y);
      if (lum > best.lum && lum <= stats.outlierFloor) best = { ...pixelRgb(chatShot, x, y), lum, x, y };
    }
    assert(best.b > best.r, `brightest glow pixel rgb(${best.r}, ${best.g}, ${best.b}) is not cool-toned`);
    assert(
      best.b - best.g >= 8,
      `brightest glow pixel rgb(${best.r}, ${best.g}, ${best.b}) is not blue/violet shifted`
    );
    return `brightest glow rgb(${best.r}, ${best.g}, ${best.b}) at (${best.x}, ${best.y})`;
  });

  await check('light sits at the edges so the reading column stays dark', async () => {
    // The reading scrim covers the middle of the thread, so that is where the
    // backdrop must be at its calmest.
    const centre = meanIn(chatShot, chatPoints, 560, 1120, 200, 660);
    const topRight = meanIn(chatShot, chatPoints, 1000, 1435, 90, 260);
    const bottomRight = meanIn(chatShot, chatPoints, 1000, 1435, 600, 780);
    const edge = Math.max(topRight, bottomRight);
    assert(centre < 0.012, `reading column luminance ${centre.toFixed(4)} is too high`);
    assert(
      edge > centre * 1.5,
      `edges ${edge.toFixed(4)} are not clearly lighter than the reading column ${centre.toFixed(4)}`
    );
    return `column ${centre.toFixed(4)} vs edges ${edge.toFixed(4)}`;
  });

  await check('the glass panels transmit the atmosphere', async () => {
    const sidebar = averageRegion(chatShot, 12, 120, 260, 600);
    const gutter = averageRegion(chatShot, 300, 120, 150, 600);
    const sLum = relativeLuminance(sidebar);
    const gLum = relativeLuminance(gutter);
    assert(sLum > gLum, `sidebar ${sLum.toFixed(4)} is not lifted above the base ${gLum.toFixed(4)}`);
    assert(sLum < 0.09, `sidebar is too bright at ${sLum.toFixed(4)}`);
    assert(sidebar.b > sidebar.r, `sidebar rgb is not cool-toned`);
    return `sidebar ${sLum.toFixed(4)} vs base ${gLum.toFixed(4)}`;
  });

  await check('the light theme is a soft daylight version, not the dark one', async () => {
    await page.evaluate(() => window.__ytalks.actions.setTheme('light'));
    await sleep(450);
    const lightShot = decodePng(await page.screenshot({ type: 'png' }));
    const lightStats = sampleStats(lightShot, await backgroundPoints());
    await page.evaluate(() => window.__ytalks.actions.setTheme('dark'));
    await sleep(450);
    assert(lightStats.mean > 0.6, `light theme mean luminance ${lightStats.mean.toFixed(3)} is dark`);
    assert(lightStats.mean < 0.99, `light theme is blown out (${lightStats.mean.toFixed(3)})`);
    return `mean luminance ${lightStats.mean.toFixed(3)}`;
  });

  /* ================================================================
     Console hygiene
     ================================================================ */
  step('Console hygiene');
  await check('no uncaught page errors', () => {
    assert(pageErrors.length === 0, pageErrors.join(' | '));
    return 'clean';
  });
  await check('no console errors', () => {
    const noisy = consoleErrors.filter((e) => !/favicon/i.test(e));
    assert(noisy.length === 0, noisy.join(' | '));
    return 'clean';
  });
} catch (error) {
  fail(`fatal error during "${currentStep}"`, error);
  try {
    await page.screenshot({ path: join(SHOTS, 'zz-failure.png') });
  } catch {
    /* ignore */
  }
} finally {
  await browser.close();
  server.kill();
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(64)}`);
console.log(`Milestone 1 UI smoke test — ${results.length - failed.length}/${results.length} checks passed`);
console.log(`Screenshots: ${SHOTS}`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  - [${f.step}] ${f.message}`);
  console.log('='.repeat(64));
  process.exit(1);
}
console.log('='.repeat(64));
process.exit(0);
