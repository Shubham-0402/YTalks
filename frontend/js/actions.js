/**
 * actions.js — every state-changing operation the UI can perform.
 *
 * Views call these functions; they never mutate the store directly. This is
 * the same split the backend will use later (controller → service → repository),
 * so moving to a real REST API in Milestone 2–3 only changes the bodies of
 * these functions, not the views.
 */

import {
  commit,
  getState,
  resetState,
  selectActiveConversation,
  selectProvider,
  STORAGE_KEY,
} from './store.js';
import { DEMO_CREDENTIALS } from './mock-data.js';
import { requestCompletion, MockProviderError } from './mock-ai.js';
import { showToast } from './ui.js';
import { uid, truncate } from './utils.js';

let activeController = null; // AbortController for the in-flight mock request

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export function login({ email, password }) {
  return new Promise((resolve, reject) => {
    // Simulated network delay so the loading state is visible in the demo.
    setTimeout(() => {
      const known = email.trim().toLowerCase() === DEMO_CREDENTIALS.email;
      if (known && password !== DEMO_CREDENTIALS.password) {
        reject(new Error('That password does not match our records.'));
        return;
      }
      if (!known && password.length < 8) {
        reject(new Error('Password must be at least 8 characters.'));
        return;
      }

      commit((s) => ({
        ...s,
        session: {
          isAuthenticated: true,
          user: {
            id: 'usr_demo_001',
            name: known ? 'Aarav Sharma' : email.split('@')[0].replace(/[._-]+/g, ' '),
            email: email.trim(),
            phone: '+91 98765 43210',
            plan: 'Free demo',
          },
        },
        activeConversationId:
          s.activeConversationId && s.conversations.some((c) => c.id === s.activeConversationId)
            ? s.activeConversationId
            : s.conversations[0]?.id || null,
      }));
      resolve(getState().session.user);
    }, 650);
  });
}

export function register({ name, email, phone }) {
  return new Promise((resolve) => {
    setTimeout(() => {
      commit((s) => ({
        ...s,
        session: {
          isAuthenticated: true,
          user: {
            id: uid('usr'),
            name: name.trim(),
            email: email.trim(),
            phone: phone?.trim() || null,
            plan: 'Free demo',
          },
        },
        // A brand-new account starts with an empty history.
        conversations: [],
        activeConversationId: null,
      }));
      resolve(getState().session.user);
    }, 750);
  });
}

export function logout() {
  stopResponding();
  commit((s) => ({ ...s, session: { isAuthenticated: false, user: null } }));
}

/* ------------------------------------------------------------------ */
/* Settings & theme                                                    */
/* ------------------------------------------------------------------ */

export function setSettings(patch) {
  commit((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  setSettings({ theme });
}

export function setSearchQuery(query) {
  commit((s) => ({ ...s, ui: { ...s.ui, searchQuery: query } }));
}

export function setSidebarOpen(open) {
  commit((s) => ({ ...s, ui: { ...s.ui, sidebarOpen: open } }));
}

export function resetDemoData() {
  stopResponding();
  resetState();
  document.documentElement.dataset.theme = getState().settings.theme;
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

function newConversation({ providerId, model, title = 'New conversation' }) {
  const now = Date.now();
  return {
    id: uid('conv'),
    title,
    createdAt: now,
    updatedAt: now,
    providerId,
    model,
    messages: [],
  };
}

export function createConversation(providerId = getState().activeProviderId) {
  const provider = selectProvider(providerId);
  const conversation = newConversation({
    providerId,
    model: provider?.defaultModel || provider?.models?.[0] || 'default',
  });
  commit((s) => ({
    ...s,
    conversations: [conversation, ...s.conversations],
    activeConversationId: conversation.id,
    activeProviderId: providerId,
    ui: { ...s.ui, sidebarOpen: false },
  }));
  return conversation;
}

export function selectConversation(id) {
  const conversation = getState().conversations.find((c) => c.id === id);
  if (!conversation) return;
  commit((s) => ({
    ...s,
    activeConversationId: id,
    activeProviderId: conversation.providerId,
    ui: { ...s.ui, sidebarOpen: false },
  }));
}

export function renameConversation(id, title) {
  const clean = title.trim();
  if (!clean) return;
  commit((s) => ({
    ...s,
    conversations: s.conversations.map((c) => (c.id === id ? { ...c, title: clean } : c)),
  }));
}

export function deleteConversation(id) {
  commit((s) => {
    const remaining = s.conversations.filter((c) => c.id !== id);
    return {
      ...s,
      conversations: remaining,
      activeConversationId:
        s.activeConversationId === id ? remaining[0]?.id || null : s.activeConversationId,
    };
  });
}

/** Copy a conversation (including its messages) and open the copy. */
export function duplicateConversation(id) {
  const source = getState().conversations.find((c) => c.id === id);
  if (!source) return null;

  const stamp = Date.now().toString(36);
  const copy = {
    ...source,
    id: uid('conv'),
    title: `${source.title} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: source.messages.map((m) => ({ ...m, id: `${m.id}_copy${stamp}` })),
  };

  commit((s) => ({
    ...s,
    conversations: [copy, ...s.conversations],
    activeConversationId: copy.id,
  }));
  return copy;
}

export function clearConversation(id) {
  commit((s) => ({
    ...s,
    conversations: s.conversations.map((c) =>
      c.id === id ? { ...c, messages: [], title: 'New conversation', updatedAt: Date.now() } : c
    ),
  }));
}

/* ------------------------------------------------------------------ */
/* Provider selection & cross-AI handoff                                */
/* ------------------------------------------------------------------ */

/**
 * Decide what should happen when the user picks a different provider.
 *
 * Returns one of:
 *   { type: 'noop' }                                  same provider
 *   { type: 'select' }                                no messages yet, safe to switch
 *   { type: 'handoff', from, to, messageCount, preview }  needs confirmation
 *   { type: 'error', message }                        invalid target
 */
export function planProviderSwitch(targetProviderId) {
  const state = getState();
  const target = selectProvider(targetProviderId, state);
  if (!target) return { type: 'error', message: 'Unknown provider.' };

  const conversation = selectActiveConversation(state);
  if (!conversation) return { type: 'select' };
  if (conversation.providerId === targetProviderId) return { type: 'noop' };

  const transferable = conversation.messages.filter(
    (m) => m.type === 'user' || m.type === 'assistant'
  );

  if (transferable.length === 0) return { type: 'select' };

  return {
    type: 'handoff',
    from: selectProvider(conversation.providerId, state),
    to: target,
    messageCount: transferable.length,
    preview: transferable.slice(-3),
  };
}

/** Switch provider on a conversation that has no history yet. */
export function applyProviderSelection(targetProviderId) {
  const state = getState();
  const target = selectProvider(targetProviderId, state);
  commit((s) => ({
    ...s,
    activeProviderId: targetProviderId,
    conversations: s.conversations.map((c) =>
      c.id === s.activeConversationId
        ? { ...c, providerId: targetProviderId, model: target?.defaultModel || c.model }
        : c
    ),
  }));
}

/**
 * YES path: continue THIS conversation on the new provider.
 * The previous messages are untouched; we only record the transition.
 */
export function continueConversationWithProvider(targetProviderId) {
  const state = getState();
  const conversation = selectActiveConversation(state);
  const target = selectProvider(targetProviderId, state);
  if (!conversation || !target) return null;

  const from = selectProvider(conversation.providerId, state);
  const transferable = conversation.messages.filter(
    (m) => m.type === 'user' || m.type === 'assistant'
  );

  const handoff = {
    id: uid('handoff'),
    type: 'handoff',
    createdAt: Date.now(),
    fromProviderId: conversation.providerId,
    fromModel: conversation.model,
    toProviderId: target.id,
    toModel: target.defaultModel,
    messageCount: transferable.length,
  };

  const updated = {
    ...conversation,
    providerId: target.id,
    model: target.defaultModel,
    updatedAt: Date.now(),
    messages: [...conversation.messages, handoff],
  };

  commit((s) => ({
    ...s,
    activeProviderId: target.id,
    conversations: s.conversations.map((c) => (c.id === conversation.id ? updated : c)),
  }));

  showToast({
    type: 'success',
    title: `Continuing with ${target.name}`,
    message: `${transferable.length} earlier message${
      transferable.length === 1 ? '' : 's'
    } will be transferred from ${from?.name || 'the previous provider'}.`,
  });

  return handoff;
}

/** NO path: start a separate conversation on the new provider. */
export function startNewChatWithProvider(targetProviderId) {
  const conversation = createConversation(targetProviderId);
  showToast({
    type: 'info',
    title: `Started a new chat with ${selectProvider(targetProviderId)?.name}`,
    message: 'The previous conversation was left untouched.',
  });
  return conversation;
}

export function setConversationModel(model) {
  const state = getState();
  const conversation = selectActiveConversation(state);
  const providerId = conversation?.providerId || state.activeProviderId;
  commit((s) => ({
    ...s,
    conversations: s.conversations.map((c) =>
      c.id === s.activeConversationId ? { ...c, model, providerId } : c
    ),
  }));
}

/* ------------------------------------------------------------------ */
/* Messaging                                                           */
/* ------------------------------------------------------------------ */

function deriveTitle(text) {
  return truncate(text, 46) || 'New conversation';
}

function appendMessages(conversationId, messages) {
  commit((s) => ({
    ...s,
    conversations: s.conversations.map((c) => {
      if (c.id !== conversationId) return c;
      const isFirstUserMessage = !c.messages.some((m) => m.type === 'user');
      const firstUserMessage = messages.find((m) => m.type === 'user');
      return {
        ...c,
        title: isFirstUserMessage && firstUserMessage ? deriveTitle(firstUserMessage.content) : c.title,
        updatedAt: Date.now(),
        messages: [...c.messages, ...messages],
      };
    }),
  }));
}

/** Send a user message and stream the mocked provider reply. */
export async function sendMessage(text, { onStream } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return null;

  const state = getState();
  let conversation = selectActiveConversation(state);

  // No conversation open yet (or brand-new account) — create one lazily.
  if (!conversation) {
    conversation = createConversation(state.activeProviderId);
  }

  const userMessage = {
    id: uid('msg'),
    type: 'user',
    content: clean,
    createdAt: Date.now(),
    providerId: null,
    model: null,
  };

  appendMessages(conversation.id, [userMessage]);

  const result = await runAssistantReply({ conversationId: conversation.id, onStream });
  return result;
}

/**
 * Ask the (mock) provider for a reply to the latest user message.
 * Shared by the normal send flow and the Retry button on error states.
 */
export async function runAssistantReply({ conversationId, onStream } = {}) {
  const state = getState();
  const id = conversationId || state.activeConversationId;
  const conversation = state.conversations.find((c) => c.id === id);
  if (!conversation) return null;

  const provider = selectProvider(conversation.providerId, state);
  if (!provider) return null;

  const lastUserMessage = [...conversation.messages].reverse().find((m) => m.type === 'user');
  if (!lastUserMessage) return null;

  activeController = new AbortController();

  try {
    const result = await requestCompletion({
      conversation,
      provider,
      model: conversation.model,
      userText: lastUserMessage.content,
      settings: state.settings,
      signal: activeController.signal,
      onDelta: onStream,
    });

    appendMessages(conversation.id, [
      {
        id: uid('msg'),
        type: 'assistant',
        content: result.text,
        createdAt: Date.now(),
        providerId: provider.id,
        model: result.model,
        latencyMs: result.latencyMs,
      },
    ]);

    return result;
  } finally {
    activeController = null;
  }
}

export function stopResponding() {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
}

export { MockProviderError, STORAGE_KEY };
