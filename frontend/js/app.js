/**
 * app.js — bootstrap and wiring.
 *
 * Responsibilities:
 *   - initialise every view exactly once
 *   - re-render the visible screen whenever the store changes
 *   - route between the auth screen and the app shell
 *   - register global keyboard shortcuts
 */

import { qs } from './utils.js';
import { getState, subscribe } from './store.js';
import * as actions from './actions.js';
import { setSidebarOpen, setTheme } from './actions.js';
import { initAuthScreen, showScreen, renderAuthScreen } from './views/auth.js';
import { initSidebar, renderSidebar } from './views/sidebar.js';
import { initChat, renderChat, chatInternals } from './views/chat.js';
import { openSettingsDialog } from './views/settings.js';
import { fetchHealth, backendBaseUrl } from './backend.js';

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

let lastAuthState = null;

function render(state) {
  renderAuthScreen();

  const authed = state.session.isAuthenticated;

  if (authed !== lastAuthState) {
    lastAuthState = authed;
    showScreen(state.ui.authView);
  }

  qs('#auth-screen').hidden = authed;
  qs('#app-shell').hidden = !authed;

  if (!authed) return;

  renderSidebar(state);
  renderChat(state);
  renderSidebarDrawer(state);
}

function renderSidebarDrawer(state) {
  const open = state.ui.sidebarOpen;
  qs('#sidebar').classList.toggle('is-open', open);
  qs('#sidebar-scrim').hidden = !open;
  qs('#open-sidebar')?.setAttribute('aria-expanded', String(open));
}

/* ------------------------------------------------------------------ */
/* Global chrome                                                       */
/* ------------------------------------------------------------------ */

function initChrome() {
  qs('#open-sidebar').addEventListener('click', () => setSidebarOpen(true));
  qs('#sidebar-scrim').addEventListener('click', () => setSidebarOpen(false));
  qs('#collapse-sidebar').addEventListener('click', () => setSidebarOpen(false));
  qs('#open-settings').addEventListener('click', openSettingsDialog);
  qs('#mobile-settings').addEventListener('click', openSettingsDialog);
}

function initShortcuts() {
  document.addEventListener('keydown', (event) => {
    const state = getState();
    if (!state.session.isAuthenticated) return;

    const target = event.target;
    const typing =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    // Ctrl/Cmd + K — focus conversation search
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setSidebarOpen(true);
      qs('#conversation-search').focus();
      qs('#conversation-search').select();
      return;
    }

    // "/" — focus search, unless the user is already typing
    if (event.key === '/' && !typing) {
      event.preventDefault();
      setSidebarOpen(true);
      qs('#conversation-search').focus();
      return;
    }

    // Escape — close the mobile sidebar
    if (event.key === 'Escape' && state.ui.sidebarOpen) {
      setSidebarOpen(false);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Backend connection badge (Milestone 2)                                */
/* ------------------------------------------------------------------ */

const BACKEND_POLL_MS = 30000;
let backendPollTimer = null;

function renderBackendBadge(state) {
  const badge = qs('[data-testid="backend-status"]');
  if (!badge) return;
  if (state === 'online') {
    badge.dataset.state = 'online';
    badge.textContent = 'Backend: connected';
    badge.setAttribute('aria-label', `Backend connected at ${backendBaseUrl()}`);
  } else if (state === 'offline') {
    badge.dataset.state = 'offline';
    badge.textContent = 'Backend: offline';
    badge.removeAttribute('aria-label');
  } else {
    badge.dataset.state = 'checking';
    badge.textContent = 'Backend: checking…';
    badge.removeAttribute('aria-label');
  }
}

async function refreshBackendStatus() {
  renderBackendBadge('checking');
  const result = await fetchHealth();
  renderBackendBadge(result.ok ? 'online' : 'offline');
  return result;
}

function initBackendStatus() {
  refreshBackendStatus();
  if (backendPollTimer) clearInterval(backendPollTimer);
  backendPollTimer = setInterval(refreshBackendStatus, BACKEND_POLL_MS);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  const state = getState();
  document.documentElement.dataset.theme = state.settings.theme;

  initAuthScreen();
  initSidebar();
  initChat();
  initChrome();
  initShortcuts();
  initBackendStatus();

  subscribe(render);
  render(state);

  // A small, deliberate testing surface. The Milestone 1 smoke test drives the
  // app through this object instead of poking at private internals.
  window.__ytalks = {
    version: 'milestone-2',
    store: { getState, subscribe },
    actions,
    chat: chatInternals(),
    showAuthScreen: (name) => showScreen(name || 'login'),
    backend: { refreshBackendStatus, backendBaseUrl },
  };

  document.documentElement.dataset.appReady = 'true';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
