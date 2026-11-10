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
import {
  login as apiLogin,
  register as apiRegister,
  registerAndVerify as apiRegisterAndVerify,
  resendOtp as apiResendOtp,
  logout as apiLogout,
  getCurrentUser as apiGetCurrentUser,
  fetchConversations as apiFetchConversations,
  createConversation as apiCreateConversation,
  fetchConversation as apiFetchConversation,
  updateConversation as apiUpdateConversation,
  deleteConversation as apiDeleteConversation,
  clearConversation as apiClearConversation,
  fetchMessages as apiFetchMessages,
  addMessage as apiAddMessage,
  sendChatMessage as apiSendChatMessage,
  setAuthToken,
  clearAuthToken,
  isAuthenticated,
} from './backend.js';

let activeController = null; // AbortController for the in-flight mock request

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export async function login({ email, password }) {
  const response = await apiLogin(email, password);
  setAuthToken(response.accessToken);

  const user = {
    id: response.user.id,
    name: response.user.name,
    email: response.user.email,
    phone: response.user.phone,
    plan: 'Free demo',
  };

  // Fetch user's conversations from backend
  const conversationsResponse = await fetchConversationsFromBackend();
  const bestConv = selectBestConversation(conversationsResponse);

  commit((s) => ({
    ...s,
    session: {
      isAuthenticated: true,
      user,
    },
    conversations: conversationsResponse,
    activeConversationId: bestConv?.id || conversationsResponse[0]?.id || null,
  }));

  showToast({ type: 'success', title: `Welcome back, ${user.name.split(' ')[0]}`, message: 'Signed in successfully.' });
  return user;
}

export async function register({ name, email, phone, password }) {
  // First step: initiate registration (sends OTP)
  const response = await apiRegister(name, email, phone, password);

  // Return the email (and devOtp if present in dev mode) so the UI can show the OTP verification screen
  return { email, name, phone, password, devOtp: response?.devOtp || null };
}

export async function verifyOtpAndRegister({ name, email, phone, password, code }) {
  const response = await apiRegisterAndVerify(name, email, phone, password, code);
  setAuthToken(response.accessToken);

  const user = {
    id: response.user.id,
    name: response.user.name,
    email: response.user.email,
    phone: response.user.phone,
    plan: 'Free demo',
  };

  // New user starts with empty conversations
  commit((s) => ({
    ...s,
    session: {
      isAuthenticated: true,
      user,
    },
    conversations: [],
    activeConversationId: null,
  }));

  showToast({
    type: 'success',
    title: `Account created for ${user.name.split(' ')[0]}`,
    message: 'You are now signed in.',
  });
  return user;
}

export async function resendOtp(email) {
  const response = await apiResendOtp(email);
  showToast({ type: 'info', title: 'OTP resent', message: 'A new verification code has been sent.' });
  return response;
}

export async function logout() {
  stopResponding();
  try {
    await apiLogout();
  } catch {
    /* ignore logout API errors when clearing local session */
  }
  clearAuthToken();
  commit((s) => ({
    ...s,
    session: { isAuthenticated: false, user: null },
    conversations: [],
    activeConversationId: null,
  }));
  showToast({ type: 'info', title: 'Signed out', message: 'You have been logged out.' });
}

export async function restoreSession() {
  if (!isAuthenticated()) {
    return false;
  }
  try {
    const userResponse = await apiGetCurrentUser();
    const user = {
      id: userResponse.id,
      name: userResponse.name,
      email: userResponse.email,
      phone: userResponse.phone,
      plan: 'Free demo',
    };

    const conversationsResponse = await fetchConversationsFromBackend();
    const bestConv = selectBestConversation(conversationsResponse);

    commit((s) => ({
      ...s,
      session: {
        isAuthenticated: true,
        user,
      },
      conversations: conversationsResponse,
      activeConversationId: bestConv?.id || conversationsResponse[0]?.id || null,
    }));
    return true;
  } catch (error) {
    // Token invalid or expired
    clearAuthToken();
    commit((s) => ({ ...s, session: { isAuthenticated: false, user: null } }));
    return false;
  }
}

const PROVIDERS_BY_NAME = {
  'OpenAI': 'openai',
  'Google Gemini': 'gemini',
  'Anthropic Claude': 'claude',
  'DeepSeek': 'deepseek',
  'Gemma 4 (OpenRouter)': 'gemma',
  'Groq': 'groq',
};

function mapBackendMessage(msg, convProviderId, convModel) {
  const senderType = msg.senderType.toLowerCase();
  const isHandoff = msg.senderType === 'SYSTEM' && msg.content?.includes('Context transferred');
  if (isHandoff) {
    // Parse "Context transferred from <From> → <To>, <N> messages transferred"
    const match = msg.content.match(/from\s+(.+?)\s*(?:→|->)\s*(.+?),\s*(\d+)\s*message/i);
    const fromName = match ? match[1].trim() : '';
    const toName = match ? match[2].trim() : '';
    const messageCount = match ? Number(match[3]) : 0;
    const fromProviderId = PROVIDERS_BY_NAME[fromName] || 'openai';
    const toProviderId = PROVIDERS_BY_NAME[toName] || convProviderId || 'gemini';
    const fromProvider = selectProvider(fromProviderId);
    const toProvider = selectProvider(toProviderId);
    return {
      id: String(msg.id),
      type: 'handoff',
      content: msg.content,
      createdAt: new Date(msg.createdAt).getTime(),
      fromProviderId,
      fromModel: fromProvider?.defaultModel || 'default',
      toProviderId,
      toModel: toProvider?.defaultModel || convModel || 'default',
      messageCount,
    };
  }
  return {
    id: String(msg.id),
    type: senderType,
    content: msg.content,
    createdAt: new Date(msg.createdAt).getTime(),
    providerId: msg.providerId,
    model: msg.model,
  };
}

async function fetchConversationsFromBackend() {
  try {
    const response = await apiFetchConversations(0, 50);
    const conversations = response.map(conv => ({
      id: String(conv.id),
      title: conv.title,
      createdAt: new Date(conv.createdAt).getTime(),
      updatedAt: new Date(conv.updatedAt).getTime(),
      providerId: conv.providerId,
      model: conv.model,
      messages: [], // List endpoint doesn't include messages
    }));

    // Load messages for all conversations so sidebar previews, full-text search,
    // and handoff counts stay accurate across reloads.
    await Promise.all(
      conversations.map(async (conv, idx) => {
        try {
          const detail = await apiFetchConversation(conv.id);
          const messages = detail.messages?.map((msg) => mapBackendMessage(msg, detail.providerId, detail.model)) || [];
          conversations[idx] = { ...conv, messages };
        } catch (error) {
          console.error(`Failed to fetch conversation ${conv.id} detail:`, error);
        }
      })
    );

    return conversations;
  } catch (error) {
    console.error('Failed to fetch conversations:', error);
    return [];
  }
}

/**
 * Selects the best conversation to activate on session restore.
 * Prefers the seeded "Java concurrency questions" conversation, 
 * falls back to the conversation with the most messages, 
 * then falls back to the first conversation.
 */
function selectBestConversation(conversations) {
  if (!conversations || conversations.length === 0) return null;
  
  // Prefer the seeded "Java concurrency questions" conversation
  const seededConv = conversations.find(c => c.title === 'Java concurrency questions');
  if (seededConv) return seededConv;
  
  // Fall back to conversation with most messages
  const withMessages = conversations.filter(c => c.messages && c.messages.length > 0);
  if (withMessages.length > 0) {
    return withMessages.reduce((a, b) => 
      (b.messages?.length || 0) > (a.messages?.length || 0) ? b : a
    );
  }
  
  // Fall back to first conversation
  return conversations[0];
}

/* ------------------------------------------------------------------ */
/* Settings & theme                                                    */
/* ------------------------------------------------------------------ */

export function setSettings(patch) {
  const enableMock =
    patch.useMockAi !== undefined
      ? Boolean(patch.useMockAi)
      : 'mockLatencyMs' in patch || ('mockErrorMode' in patch && patch.mockErrorMode !== 'none')
      ? true
      : undefined;
  commit((s) => ({
    ...s,
    settings: {
      ...s.settings,
      ...patch,
      ...(enableMock !== undefined ? { useMockAi: enableMock } : {}),
    },
  }));
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

// Maps temporary local conversation IDs to promises resolving their backend ID
const pendingConversationCreates = new Map();
const resolvedConversationIds = new Map();

async function resolveBackendConversationId(id) {
  if (!id) return id;
  const strId = String(id);
  if (/^\d+$/.test(strId)) return strId;
  if (resolvedConversationIds.has(strId)) {
    return resolvedConversationIds.get(strId);
  }
  const pendingPromise = pendingConversationCreates.get(strId);
  if (pendingPromise) {
    try {
      const resolvedId = await pendingPromise;
      if (resolvedId) return resolvedId;
    } catch {
      /* ignore */
    }
  }
  if (resolvedConversationIds.has(strId)) {
    return resolvedConversationIds.get(strId);
  }
  const current = getState().activeConversationId;
  if (current && /^\d+$/.test(String(current))) return String(current);
  return strId;
}

export async function createConversation(providerId) {
  const state = getState();
  const resolvedProviderId =
    providerId ||
    (!state.settings.useMockAi && !selectProvider(state.activeProviderId, state)?.implemented
      ? 'gemini'
      : state.activeProviderId);
  const provider = selectProvider(resolvedProviderId, state);
  const conversation = newConversation({
    providerId: resolvedProviderId,
    model: provider?.defaultModel || provider?.models?.[0] || 'default',
  });
  const tempId = conversation.id;

  // Optimistically add to local store
  commit((s) => ({
    ...s,
    conversations: [conversation, ...s.conversations],
    activeConversationId: tempId,
    activeProviderId: resolvedProviderId,
    ui: { ...s.ui, sidebarOpen: false },
  }));

  // Persist to backend
  const createPromise = (async () => {
    try {
      const latestLocal = getState().conversations.find((c) => c.id === tempId) || conversation;
      const backendConv = await apiCreateConversation(latestLocal.title, latestLocal.providerId, latestLocal.model);
      const realId = String(backendConv.id);
      resolvedConversationIds.set(tempId, realId);
      commit((s) => ({
        ...s,
        activeConversationId: s.activeConversationId === tempId ? realId : s.activeConversationId,
        conversations: s.conversations.map((c) =>
          c.id === tempId
            ? {
                ...c,
                id: realId,
                createdAt: new Date(backendConv.createdAt).getTime(),
                updatedAt: new Date(backendConv.updatedAt).getTime(),
              }
            : c
        ),
      }));
      return realId;
    } catch (error) {
      console.error('Failed to create conversation on backend:', error);
      return null;
    } finally {
      pendingConversationCreates.delete(tempId);
    }
  })();

  pendingConversationCreates.set(tempId, createPromise);
  await createPromise;

  return getState().conversations.find((c) => c.id === getState().activeConversationId) || conversation;
}

export function selectConversation(id) {
  const conversation = getState().conversations.find((c) => c.id === id);
  if (!conversation) return;
  
  // If the conversation already has messages loaded, just select it
  if (conversation.messages && conversation.messages.length > 0) {
    commit((s) => ({
      ...s,
      activeConversationId: id,
      activeProviderId: conversation.providerId,
      ui: { ...s.ui, sidebarOpen: false },
    }));
    return;
  }
  
  // Otherwise, fetch the conversation detail with messages from the backend
  (async () => {
    try {
      const backendId = await resolveBackendConversationId(id);
      const detail = await apiFetchConversation(backendId);
      const messages = detail.messages?.map((msg) => mapBackendMessage(msg, detail.providerId, detail.model)) || [];
      
      commit((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === id || c.id === backendId ? { ...c, messages } : c
        ),
        activeConversationId: backendId,
        activeProviderId: detail.providerId,
        ui: { ...s.ui, sidebarOpen: false },
      }));
    } catch (error) {
      console.error('Failed to fetch conversation detail:', error);
      // Fallback: just select the conversation without messages
      commit((s) => ({
        ...s,
        activeConversationId: id,
        activeProviderId: conversation.providerId,
        ui: { ...s.ui, sidebarOpen: false },
      }));
    }
  })();
}

export function renameConversation(id, title) {
  const clean = title.trim();
  if (!clean) return;
  const targetId = resolvedConversationIds.get(String(id)) || id;
  commit((s) => ({
    ...s,
    conversations: s.conversations.map((c) =>
      c.id === id || c.id === targetId ? { ...c, title: clean, updatedAt: Date.now() } : c
    ),
  }));

  (async () => {
    try {
      const backendId = await resolveBackendConversationId(id);
      if (/^\d+$/.test(backendId)) {
        const conv = getState().conversations.find((c) => c.id === backendId || c.id === id);
        await apiUpdateConversation(backendId, clean, conv?.providerId || null, conv?.model || null);
      }
    } catch (error) {
      console.error('Failed to rename conversation on backend:', error);
    }
  })();
}

export function deleteConversation(id) {
  const targetId = resolvedConversationIds.get(String(id)) || id;
  commit((s) => {
    const remaining = s.conversations.filter((c) => c.id !== id && c.id !== targetId);
    return {
      ...s,
      conversations: remaining,
      activeConversationId:
        s.activeConversationId === id || s.activeConversationId === targetId
          ? remaining[0]?.id || null
          : s.activeConversationId,
    };
  });

  (async () => {
    try {
      const backendId = await resolveBackendConversationId(id);
      if (/^\d+$/.test(backendId)) {
        await apiDeleteConversation(backendId);
      }
    } catch (error) {
      console.error('Failed to delete conversation on backend:', error);
    }
  })();
}

/** Copy a conversation (including its messages) and open the copy. */
export function duplicateConversation(id) {
  const targetId = resolvedConversationIds.get(String(id)) || id;
  const source = getState().conversations.find((c) => c.id === id || c.id === targetId);
  if (!source) return null;

  const stamp = Date.now().toString(36);
  const tempId = uid('conv');
  const copy = {
    ...source,
    id: tempId,
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

  // Persist duplicated conversation and its messages to backend
  const createPromise = (async () => {
    try {
      const backendConv = await apiCreateConversation(copy.title, copy.providerId, copy.model);
      const realId = String(backendConv.id);
      resolvedConversationIds.set(tempId, realId);
      commit((s) => ({
        ...s,
        activeConversationId: s.activeConversationId === tempId ? realId : s.activeConversationId,
        conversations: s.conversations.map((c) =>
          c.id === tempId ? { ...c, id: realId } : c
        ),
      }));
      for (const msg of source.messages) {
        if (msg.type === 'user') {
          await apiAddMessage(realId, 'USER', msg.content, null, null);
        } else if (msg.type === 'assistant') {
          await apiAddMessage(realId, 'ASSISTANT', msg.content, msg.providerId, msg.model);
        } else if (msg.type === 'handoff') {
          await apiAddMessage(realId, 'SYSTEM', msg.content || 'Context transferred', null, null);
        }
      }
      return realId;
    } catch (error) {
      console.error('Failed to persist duplicated conversation to backend:', error);
      return null;
    } finally {
      pendingConversationCreates.delete(tempId);
    }
  })();
  pendingConversationCreates.set(tempId, createPromise);

  return copy;
}

export function clearConversation(id) {
  const targetId = resolvedConversationIds.get(String(id)) || id;
  commit((s) => ({
    ...s,
    conversations: s.conversations.map((c) =>
      c.id === id || c.id === targetId
        ? { ...c, messages: [], title: 'New conversation', updatedAt: Date.now() }
        : c
    ),
  }));

  (async () => {
    try {
      const backendId = await resolveBackendConversationId(id);
      if (/^\d+$/.test(backendId)) {
        await apiClearConversation(backendId);
      }
    } catch (error) {
      console.error('Failed to clear conversation on backend:', error);
    }
  })();
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
    conversationTitle: conversation.title,
    messageCount: transferable.length,
    preview: transferable.slice(-3),
  };
}

/** Switch provider on a conversation that has no history yet. */
export function applyProviderSelection(targetProviderId) {
  const state = getState();
  const target = selectProvider(targetProviderId, state);
  const activeId = state.activeConversationId;
  commit((s) => ({
    ...s,
    activeProviderId: targetProviderId,
    conversations: s.conversations.map((c) =>
      c.id === s.activeConversationId
        ? { ...c, providerId: targetProviderId, model: target?.defaultModel || c.model }
        : c
    ),
  }));

  if (activeId) {
    (async () => {
      try {
        const backendId = await resolveBackendConversationId(activeId);
        if (/^\d+$/.test(backendId)) {
          const conv = getState().conversations.find((c) => c.id === backendId || c.id === activeId);
          await apiUpdateConversation(backendId, conv?.title || null, targetProviderId, target?.defaultModel || conv?.model || null);
        }
      } catch (error) {
        console.error('Failed to update conversation provider on backend:', error);
      }
    })();
  }
}

/**
 * YES path: continue THIS conversation on the new provider.
 * The previous messages are untouched; we only record the transition.
 */
export async function continueConversationWithProvider(targetProviderId) {
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
    content: `Context transferred from ${from?.name || 'previous provider'} → ${target.name}, ${transferable.length} messages transferred`,
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

  // Persist handoff message to backend
  try {
    const backendId = await resolveBackendConversationId(conversation.id);
    if (/^\d+$/.test(backendId)) {
      await apiAddMessage(backendId, 'SYSTEM', handoff.content || `Context transferred from ${from?.name || 'previous provider'} → ${target.name}, ${transferable.length} messages transferred`, null, null);
      // Also update conversation provider/model on backend
      await apiUpdateConversation(backendId, conversation.title, target.id, target.defaultModel);
    }
  } catch (error) {
    console.error('Failed to persist handoff to backend:', error);
  }

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
  const activeId = state.activeConversationId;
  commit((s) => ({
    ...s,
    conversations: s.conversations.map((c) =>
      c.id === s.activeConversationId ? { ...c, model, providerId } : c
    ),
  }));

  if (activeId) {
    (async () => {
      try {
        const backendId = await resolveBackendConversationId(activeId);
        if (/^\d+$/.test(backendId)) {
          const conv = getState().conversations.find((c) => c.id === backendId || c.id === activeId);
          await apiUpdateConversation(backendId, conv?.title || null, providerId, model);
        }
      } catch (error) {
        console.error('Failed to update conversation model on backend:', error);
      }
    })();
  }
}

/* ------------------------------------------------------------------ */
/* Messaging                                                           */
/* ------------------------------------------------------------------ */

function deriveTitle(text) {
  return truncate(text, 46) || 'New conversation';
}

function appendMessages(conversationId, messages) {
  const targetId = resolvedConversationIds.get(String(conversationId)) || conversationId;
  commit((s) => ({
    ...s,
    conversations: s.conversations.map((c) => {
      if (c.id !== conversationId && c.id !== targetId) return c;
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

/** Send a user message and request the AI provider reply. */
export async function sendMessage(text, { onStream } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return null;

  const state = getState();
  let conversation = selectActiveConversation(state);

  // No conversation open yet (or brand-new account) — create one lazily.
  if (!conversation) {
    conversation = await createConversation(state.activeProviderId);
  }

  const wasFirstUserMessage = !conversation.messages.some((m) => m.type === 'user');

  const userMessage = {
    id: uid('msg'),
    type: 'user',
    content: clean,
    createdAt: Date.now(),
    providerId: null,
    model: null,
  };

  appendMessages(conversation.id, [userMessage]);

  const backendConvId = await resolveBackendConversationId(conversation.id);
  const useMock = Boolean(getState().settings?.useMockAi);

  if (/^\d+$/.test(backendConvId)) {
    try {
      // In mock mode, persist the user message via /api/conversations/{id}/messages.
      // In real mode, POST /api/chat/{id}/messages persists both user and assistant messages
      // (with retry deduplication), avoiding duplicate user messages in MySQL.
      if (useMock) {
        const savedMsg = await apiAddMessage(backendConvId, 'USER', clean, null, null);
        if (savedMsg?.id) {
          commit((s) => ({
            ...s,
            conversations: s.conversations.map((c) =>
              c.id === backendConvId
                ? {
                    ...c,
                    messages: c.messages.map((m) => (m.id === userMessage.id ? { ...m, id: String(savedMsg.id) } : m)),
                  }
                : c
            ),
          }));
        }
      }
      if (wasFirstUserMessage) {
        const updatedConv = getState().conversations.find((c) => c.id === backendConvId);
        if (updatedConv) {
          await apiUpdateConversation(backendConvId, updatedConv.title, updatedConv.providerId, updatedConv.model);
        }
      }
    } catch (error) {
      console.error('Failed to persist conversation metadata to backend:', error);
    }
  }

  const result = await runAssistantReply({ conversationId: backendConvId, onStream });
  return result;
}

/**
 * Request an assistant reply to the latest user message.
 * Uses POST /api/chat/{conversationId}/messages for real backend chat,
 * or mock-ai.js only when mock mode is explicitly enabled for prototype testing.
 */
export async function runAssistantReply({ conversationId, onStream } = {}) {
  const state = getState();
  const resolvedId = await resolveBackendConversationId(conversationId || state.activeConversationId);
  const conversation = getState().conversations.find((c) => c.id === resolvedId || c.id === conversationId);
  if (!conversation) return null;

  const provider = selectProvider(conversation.providerId, getState());
  if (!provider) return null;

  const lastUserMessage = [...conversation.messages].reverse().find((m) => m.type === 'user');
  if (!lastUserMessage) return null;

  activeController = new AbortController();
  const useMock = Boolean(getState().settings?.useMockAi);

  try {
    if (!useMock) {
      const backendConvId = await resolveBackendConversationId(conversation.id);
      const response = await apiSendChatMessage(
        backendConvId,
        lastUserMessage.content,
        provider.id,
        conversation.model,
        { signal: activeController.signal }
      );

      onStream?.(response.content);
      if (provider) provider.live = true; // verified by a real backend reply

      const assistantMsg = {
        id: String(response.messageId || uid('msg')),
        type: 'assistant',
        content: response.content,
        createdAt: Date.now(),
        providerId: response.providerId || provider.id,
        model: response.model || conversation.model,
        latencyMs: response.latencyMs,
      };

      const currentConvId = getState().conversations.find((c) => c.id === resolvedId)?.id || conversation.id;
      appendMessages(currentConvId, [assistantMsg]);

      if (response.model && response.model !== conversation.model) {
        commit((s) => ({
          ...s,
          conversations: s.conversations.map((c) =>
            c.id === currentConvId || c.id === backendConvId ? { ...c, model: response.model } : c
          ),
        }));
      }

      return {
        text: response.content,
        model: response.model || conversation.model,
        latencyMs: response.latencyMs,
      };
    }

    const result = await requestCompletion({
      conversation,
      provider,
      model: conversation.model,
      userText: lastUserMessage.content,
      settings: getState().settings,
      signal: activeController.signal,
      onDelta: onStream,
    });

    const assistantMsg = {
      id: uid('msg'),
      type: 'assistant',
      content: result.text,
      createdAt: Date.now(),
      providerId: provider.id,
      model: result.model,
      latencyMs: result.latencyMs,
    };

    const currentConvId = getState().conversations.find((c) => c.id === resolvedId)?.id || conversation.id;
    appendMessages(currentConvId, [assistantMsg]);

    // Persist mocked assistant reply to backend
    const backendConvId = await resolveBackendConversationId(currentConvId);
    if (/^\d+$/.test(backendConvId)) {
      try {
        const savedAssistant = await apiAddMessage(backendConvId, 'ASSISTANT', result.text, provider.id, result.model);
        if (savedAssistant?.id) {
          commit((s) => ({
            ...s,
            conversations: s.conversations.map((c) =>
              c.id === backendConvId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsg.id ? { ...m, id: String(savedAssistant.id) } : m
                    ),
                  }
                : c
            ),
          }));
        }
      } catch (error) {
        console.error('Failed to persist assistant message to backend:', error);
      }
    }

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
