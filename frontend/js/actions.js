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
  await apiRegister(name, email, phone, password);

  // Return the email so the UI can show the OTP verification screen
  return { email, name, phone, password };
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
  await apiResendOtp(email);
  showToast({ type: 'info', title: 'OTP resent', message: 'A new verification code has been sent.' });
}

export async function logout() {
  stopResponding();
  await apiLogout();
  clearAuthToken();
  commit((s) => ({ ...s, session: { isAuthenticated: false, user: null } }));
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

    // Find the best conversation to load messages for
    const bestConv = selectBestConversation(conversations);
    if (bestConv) {
      try {
        const detail = await apiFetchConversation(bestConv.id);
        const messages = detail.messages?.map(msg => {
          const senderType = msg.senderType.toLowerCase();
          // Detect handoff messages (SYSTEM type with handoff content)
          const isHandoff = msg.senderType === 'SYSTEM' && msg.content?.includes('Context transferred');
          return {
            id: String(msg.id),
            type: isHandoff ? 'handoff' : senderType,
            content: msg.content,
            createdAt: new Date(msg.createdAt).getTime(),
            providerId: msg.providerId,
            model: msg.model,
          };
        }) || [];
        
        // Update the best conversation with messages
        const idx = conversations.findIndex(c => c.id === bestConv.id);
        if (idx >= 0) {
          conversations[idx] = { ...bestConv, messages };
        }
      } catch (error) {
        console.error('Failed to fetch best conversation detail:', error);
      }
    }

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

export async function createConversation(providerId = getState().activeProviderId) {
  const provider = selectProvider(providerId);
  const conversation = newConversation({
    providerId,
    model: provider?.defaultModel || provider?.models?.[0] || 'default',
  });

  // Optimistically add to local store
  commit((s) => ({
    ...s,
    conversations: [conversation, ...s.conversations],
    activeConversationId: conversation.id,
    activeProviderId: providerId,
    ui: { ...s.ui, sidebarOpen: false },
  }));

  // Persist to backend
  try {
    const backendConv = await apiCreateConversation(conversation.title, providerId, conversation.model);
    // Replace the optimistic conversation with the backend version (which has a real ID)
    // Also update activeConversationId to the new backend ID
    commit((s) => ({
      ...s,
      activeConversationId: String(backendConv.id),
      conversations: s.conversations.map((c) =>
        c.id === conversation.id ? { ...c, id: String(backendConv.id), createdAt: new Date(backendConv.createdAt).getTime(), updatedAt: new Date(backendConv.updatedAt).getTime() } : c
      ),
    }));
  } catch (error) {
    console.error('Failed to create conversation on backend:', error);
    // Keep the optimistic conversation if backend fails
  }

  return conversation;
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
      const detail = await apiFetchConversation(id);
      const messages = detail.messages?.map(msg => {
        const senderType = msg.senderType.toLowerCase();
        // Detect handoff messages (SYSTEM type with handoff content)
        const isHandoff = msg.senderType === 'SYSTEM' && msg.content?.includes('Context transferred');
        return {
          id: String(msg.id),
          type: isHandoff ? 'handoff' : senderType,
          content: msg.content,
          createdAt: new Date(msg.createdAt).getTime(),
          providerId: msg.providerId,
          model: msg.model,
        };
      }) || [];
      
      commit((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, messages } : c
        ),
        activeConversationId: id,
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
    await apiAddMessage(conversation.id, 'SYSTEM', handoff.content || `Context transferred from ${from?.name || 'previous provider'} → ${target.name}, ${transferable.length} messages transferred`, null, null);
    // Also update conversation provider/model on backend
    await apiUpdateConversation(conversation.id, conversation.title, target.id, target.defaultModel);
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
