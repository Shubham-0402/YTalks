/**
 * store.js — the single source of truth for prototype state.
 *
 * Responsibilities:
 *   1. Hold the state object (session, settings, providers, conversations).
 *   2. Persist it to localStorage so a page refresh keeps the demo data.
 *   3. Notify subscribers when something changed.
 *
 * This deliberately mirrors what the Spring Boot backend will own in
 * Milestones 3+ (users, conversations, messages). When the real API arrives,
 * `actions.js` will call fetch() instead of mutating this object.
 */

import { PROVIDERS, DEMO_USER, buildSeedConversations } from './mock-data.js';

const STORAGE_KEY = 'ytalks.milestone1.v1';
const SCHEMA_VERSION = 1;

/** Shape of the whole prototype state. */
function createInitialState() {
  return {
    version: SCHEMA_VERSION,
    session: {
      isAuthenticated: false,
      user: null,
    },
    settings: {
      theme: 'dark',
      /** Base simulated reply latency in ms. */
      mockLatencyMs: 900,
      /** 'none' | 'rate_limit' | 'timeout' | 'network' | 'invalid' */
      mockErrorMode: 'none',
      streamTokens: true,
    },
    ui: {
      authView: 'login',
      sidebarOpen: false,
      searchQuery: '',
    },
    providers: PROVIDERS,
    activeProviderId: 'openai',
    conversations: buildSeedConversations(),
    activeConversationId: 'conv_java_threads',
  };
}

let state = createInitialState();
const listeners = new Set();

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // Private-mode browsers and full quotas should never break the demo.
    console.warn('[store] could not persist state:', error.message);
  }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.version !== SCHEMA_VERSION) return; // ignore stale formats
    state = { ...createInitialState(), ...saved, ui: createInitialState().ui };
  } catch (error) {
    console.warn('[store] ignoring unreadable saved state:', error.message);
  }
}

restore();

/* ------------------------------------------------------------------ */
/* Read / write                                                        */
/* ------------------------------------------------------------------ */

export const getState = () => state;

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Apply a mutation. The mutator receives a shallow draft of the state and may
 * return a partial state object, or mutate and return nothing.
 */
export function commit(mutator) {
  const result = mutator(state) || state;
  state = { ...result };
  persist();
  listeners.forEach((listener) => listener(state));
  return state;
}

/** Replace the whole state (used by the demo reset button). */
export function resetState() {
  state = createInitialState();
  persist();
  listeners.forEach((listener) => listener(state));
}

/* ------------------------------------------------------------------ */
/* Selectors — derived, read-only values used by the views             */
/* ------------------------------------------------------------------ */

export const selectActiveConversation = (s = state) =>
  s.conversations.find((c) => c.id === s.activeConversationId) || null;

export const selectProvider = (id, s = state) =>
  s.providers.find((p) => p.id === id) || null;

export const selectActiveProvider = (s = state) => selectProvider(s.activeProviderId, s);

export const selectMessages = (conversation) => (conversation ? conversation.messages : []);

/** Conversations ordered newest-first, optionally filtered by a search term. */
export function selectVisibleConversations(s = state) {
  const query = s.ui.searchQuery.trim().toLowerCase();
  const list = query
    ? s.conversations.filter((c) => {
        if (c.title.toLowerCase().includes(query)) return true;
        return c.messages.some((m) => (m.content || '').toLowerCase().includes(query));
      })
    : s.conversations;

  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Counters used by the settings panel. */
export function selectStats(s = state) {
  const messages = s.conversations.flatMap((c) => c.messages);
  const handoffs = messages.filter((m) => m.type === 'handoff').length;
  const providersUsed = new Set(
    messages.filter((m) => m.type === 'assistant').map((m) => m.providerId)
  );
  return {
    conversations: s.conversations.length,
    messages: messages.filter((m) => m.type !== 'handoff').length,
    handoffs,
    providers: providersUsed.size,
  };
}

export { DEMO_USER, STORAGE_KEY };
