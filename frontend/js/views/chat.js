/**
 * views/chat.js — the main chat area: header, provider selector, message
 * list, composer, and the cross-AI handoff flow.
 *
 * This is the module that Milestones 5–7 will keep. Only the `onStream` /
 * `runAssistantReply` call changes when a real backend replaces the mock.
 */

import { qs, el, esc, icon, formatTime, formatFull, isSameDay, renderRichText, copyText } from '../utils.js';
import { openMenu, showToast, confirmDialog } from '../ui.js';
import { getState, selectActiveConversation, selectProvider } from '../store.js';
import {
  planProviderSwitch,
  applyProviderSelection,
  continueConversationWithProvider,
  startNewChatWithProvider,
  setConversationModel,
  createConversation,
  sendMessage,
  runAssistantReply,
  stopResponding,
  clearConversation,
} from '../actions.js';
import { openHandoffDialog } from './handoff-dialog.js';
import { STARTER_PROMPTS } from '../mock-data.js';
import { startRename, exportConversation } from './sidebar.js';

/**
 * In-flight request state. Deliberately kept outside the persisted store:
 * it is UI-only and must not survive a reload.
 */
let pending = null; // { conversationId, providerId, text, error }

/* ------------------------------------------------------------------ */
/* Message rendering                                                   */
/* ------------------------------------------------------------------ */

function handoffDivider(message, state) {
  const from = selectProvider(message.fromProviderId, state);
  const to = selectProvider(message.toProviderId, state);
  return `
    <div class="handoff" role="separator" aria-label="Context transferred from ${esc(
      from?.name || message.fromProviderId
    )} to ${esc(to?.name || message.toProviderId)}">
      <span class="handoff__line" aria-hidden="true"></span>
      <span class="handoff__pill">
        ${icon('arrows', 13)}
        <span>Context transferred <strong>${esc(from?.name || message.fromProviderId)}</strong>
        &rarr; <strong>${esc(to?.name || message.toProviderId)}</strong></span>
        <span class="handoff__count">${message.messageCount} messages</span>
      </span>
      <span class="handoff__line" aria-hidden="true"></span>
    </div>`;
}

function messageNode(message, state) {
  if (message.type === 'handoff') return handoffDivider(message, state);

  const isUser = message.type === 'user';
  const provider = isUser ? null : selectProvider(message.providerId, state);
  const hue = provider?.accent || '#888888';

  const footer = isUser
    ? `<button class="msg__action" data-copy="${esc(message.content)}">${icon('copy', 12)} Copy</button>`
    : `<button class="msg__action" data-copy="${esc(message.content)}">${icon('copy', 12)} Copy</button>
       <span>${esc(message.model || '')}</span>
       ${message.latencyMs ? `<span>${(message.latencyMs / 1000).toFixed(1)}s</span>` : ''}`;

  return `
    <article class="msg msg--${isUser ? 'user' : 'ai'}"
             data-provider="${esc(message.providerId || 'user')}"
             aria-label="${isUser ? 'Your message' : `Reply from ${esc(provider?.name || 'AI')}`}">
      <span class="avatar ${isUser ? 'avatar--user' : 'avatar--ai'} avatar--md" aria-hidden="true"
            style="${isUser ? '' : `--provider-hue:${hue}`}">
        ${isUser ? esc(initialsOf(state)) : esc(provider?.shortName || 'AI')}
      </span>
      <div class="msg__col">
        <div class="msg__bubble">${renderRichText(message.content)}</div>
        <div class="msg__foot">
          <time datetime="${new Date(message.createdAt).toISOString()}" title="${esc(formatFull(message.createdAt))}">
            ${esc(formatTime(message.createdAt))}
          </time>
          ${footer}
        </div>
      </div>
    </article>`;
}

function initialsOf(state) {
  const name = state.session.user?.name || 'You';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function pendingNode(p, state) {
  const provider = selectProvider(p.providerId, state);
  const isError = Boolean(p.error);

  if (isError) {
    return `
      <article class="msg msg--ai msg--error" data-testid="error-message">
        <span class="avatar avatar--ai avatar--md" aria-hidden="true" style="--provider-hue:${esc(provider?.accent || '#888')}">
          ${esc(provider?.shortName || 'AI')}
        </span>
        <div class="msg__col">
          <div class="msg__bubble">
            <p><strong>${esc(p.error.title)}</strong></p>
            <p>${esc(p.error.message)}</p>
            ${p.error.hint ? `<p style="color:var(--text-tertiary)">${esc(p.error.hint)}</p>` : ''}
            <div class="msg__error-actions">
              <button class="btn btn--secondary btn--sm" data-retry="true">${icon('refresh', 14)} Try again</button>
              <button class="btn btn--ghost btn--sm" data-save-error="true">Keep in chat</button>
            </div>
          </div>
          <div class="msg__foot"><span>${esc(provider?.name || '')} · failed</span></div>
        </div>
      </article>`;
  }

  return `
    <article class="msg msg--ai" data-testid="streaming-message">
      <span class="avatar avatar--ai avatar--md" aria-hidden="true" style="--provider-hue:${esc(provider?.accent || '#888')}">
        ${esc(provider?.shortName || 'AI')}
      </span>
      <div class="msg__col">
        <div class="msg__bubble" data-stream-bubble>
          ${
            p.text
              ? renderRichText(p.text)
              : `<span class="typing-dots" role="status" aria-label="${esc(provider?.name || 'AI')} is typing">
                   <span></span><span></span><span></span>
                 </span>`
          }
        </div>
        <div class="msg__foot">
          <span>${esc(provider?.name || '')} is responding…</span>
        </div>
      </div>
    </article>`;
}

function emptyState(state) {
  const provider = selectProvider(state.activeProviderId, state);
  return `
    <div class="state" data-testid="empty-state">
      <span class="orb" aria-hidden="true">
        <span class="orb__glyph">${icon('sparkles', 26)}</span>
      </span>
      <p class="state__title">How can I help, ${esc((state.session.user?.name || 'there').split(' ')[0])}?</p>
      <p class="state__text">
        This is a <strong>mock</strong> conversation with ${esc(provider?.name || 'the selected provider')}.
        No AI API is being called in Milestone 1 — replies are generated locally so the
        interface can be demonstrated end to end.
      </p>
      <div class="state__actions">
        ${STARTER_PROMPTS.map(
          (prompt) =>
            `<button class="btn btn--secondary btn--sm" data-prompt="${esc(prompt)}">${esc(
              prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt
            )}</button>`
        ).join('')}
      </div>
    </div>`;
}

function loadingSkeleton() {
  return `
    <div data-testid="loading-skeleton" aria-label="Loading conversation">
      <div class="msg msg--ai">
        <span class="skeleton" style="width:30px;height:30px;border-radius:var(--radius-md)"></span>
        <div class="msg__col" style="width:min(100%,520px)">
          <span class="skeleton" style="height:14px;width:92%"></span>
          <span class="skeleton" style="height:14px;width:74%"></span>
        </div>
      </div>
      <div class="msg msg--user">
        <span class="skeleton" style="width:30px;height:30px;border-radius:50%"></span>
        <div class="msg__col" style="width:min(100%,380px)">
          <span class="skeleton" style="height:14px;width:70%"></span>
        </div>
      </div>
      <div class="msg msg--ai">
        <span class="skeleton" style="width:30px;height:30px;border-radius:var(--radius-md)"></span>
        <div class="msg__col" style="width:min(100%,480px)">
          <span class="skeleton" style="height:14px;width:88%"></span>
          <span class="skeleton" style="height:14px;width:60%"></span>
        </div>
      </div>
    </div>`;
}

function renderMessages(state) {
  const inner = qs('#messages-inner');
  const conversation = selectActiveConversation(state);

  if (!conversation) {
    inner.innerHTML = emptyState(state);
    return;
  }

  if (conversation.messages.length === 0 && !pending) {
    inner.innerHTML = emptyState(state);
    return;
  }

  // Insert day dividers whenever the calendar day changes.
  const chunks = [];
  let previous = null;
  for (const message of conversation.messages) {
    if (!previous || !isSameDay(previous, message.createdAt)) {
      chunks.push(
        `<div class="day-divider"><span>${esc(
          new Date(message.createdAt).toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          })
        )}</span></div>`
      );
    }
    chunks.push(messageNode(message, state));
    previous = message.createdAt;
  }

  if (pending && pending.conversationId === conversation.id) {
    chunks.push(pendingNode(pending, state));
  }

  inner.innerHTML = chunks.join('');
}

/* ------------------------------------------------------------------ */
/* Header + provider selector                                          */
/* ------------------------------------------------------------------ */

function renderHeader(state) {
  const conversation = selectActiveConversation(state);
  const provider = selectProvider(
    conversation?.providerId || state.activeProviderId,
    state
  );
  const model = conversation?.model || provider?.defaultModel || '';

  qs('#chat-title').textContent = conversation?.title || 'New conversation';

  const handoffs = (conversation?.messages || []).filter((m) => m.type === 'handoff').length;
  qs('#chat-subtitle').innerHTML = `
    <span class="badge badge--provider" data-provider="${esc(provider?.id || '')}"
          style="--provider-hue:${esc(provider?.accent || '#888')}">
      <span class="dot dot--live" aria-hidden="true"></span>${esc(provider?.name || 'No provider')}
    </span>
    <span>${esc(model)}</span>
    ${handoffs ? `<span>· ${handoffs} cross-AI handoff${handoffs === 1 ? '' : 's'}</span>` : ''}
    <span class="badge badge--demo">Mock</span>`;

  renderProviderTrigger(provider, model);
}

function renderProviderTrigger(provider, model) {
  const host = qs('#provider-select');
  host.innerHTML = '';
  if (!provider) return;

  const trigger = el('button', {
    class: 'provider-trigger',
    type: 'button',
    id: 'provider-trigger',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': `Active provider: ${provider.name}, model ${model}. Change provider`,
  }, [
    el('span', {
      class: 'provider-trigger__logo',
      style: { '--provider-hue': provider.accent },
      text: provider.shortName,
    }),
    el('span', { text: provider.name }),
    el('span', { class: 'provider-trigger__model', text: model }),
    el('span', { html: icon('chevron-down', 14) }),
  ]);

  trigger.addEventListener('click', () => openProviderMenu(trigger, provider));
  host.append(trigger);
}

function openProviderMenu(anchor, activeProvider) {
  const state = getState();
  const conversation = selectActiveConversation(state);

  openMenu(
    anchor,
    ({ close }) => {
      const menu = el('div', { class: 'provider-menu', role: 'menu' });
      menu.append(
        el('p', { class: 'menu__section-label', text: 'Choose an AI provider' })
      );

      for (const provider of state.providers) {
        const isActive = provider.id === activeProvider.id;
        const option = el('button', {
          class: 'provider-option',
          role: 'menuitemradio',
          type: 'button',
          'aria-checked': String(isActive),
          'data-provider-id': provider.id,
          style: { '--provider-hue': provider.accent },
          onclick: () => requestProviderSwitch(provider.id, close),
        });

        option.append(
          el('span', { class: 'provider-option__logo', text: provider.shortName }),
          el('span', { class: 'provider-option__body' }, [
            el('span', { class: 'provider-option__name' }, [
              provider.name,
              isActive ? el('span', { class: 'menu__check', html: icon('check', 14) }) : null,
            ]),
            el('span', { class: 'provider-option__desc', text: provider.description }),
            el('span', { class: 'provider-option__model', text: `default: ${provider.defaultModel}` }),
          ])
        );

        // The active provider exposes its model list so the model can be changed.
        if (isActive) {
          const row = el('span', { class: 'model-row' });
          for (const model of provider.models) {
            const chip = el('button', {
              class: `model-chip${model === (conversation?.model || provider.defaultModel) ? ' is-active' : ''}`,
              type: 'button',
              text: model,
              'aria-pressed': String(model === (conversation?.model || provider.defaultModel)),
              onclick: (event) => {
                event.stopPropagation();
                setConversationModel(model);
                showToast({ type: 'success', title: `Model set to ${model}`, timeout: 2400 });
                close();
              },
            });
            row.append(chip);
          }
          option.querySelector('.provider-option__body').append(row);
        }

        menu.append(option);
      }

      menu.append(
        el('p', {
          class: 'menu__section-label',
          style: { padding: 'var(--space-2) var(--space-3)', textTransform: 'none', letterSpacing: '0' },
          text: 'Switching mid-conversation asks whether to transfer context.',
        })
      );
      return menu;
    },
    { align: 'end' }
  );
}

/**
 * Provider switch flow. This is the logic the project is about, so it is kept
 * explicit and readable rather than hidden in a generic helper.
 */
function requestProviderSwitch(targetProviderId, closeMenu) {
  const plan = planProviderSwitch(targetProviderId);
  closeMenu?.();

  if (plan.type === 'error') {
    showToast({ type: 'error', title: 'Provider unavailable', message: plan.message });
    return;
  }
  if (plan.type === 'noop') return;
  if (plan.type === 'select') {
    applyProviderSelection(targetProviderId);
    showToast({
      type: 'success',
      title: `Switched to ${plan.to?.name || 'provider'}`,
      message: 'No earlier messages needed transferring.',
      timeout: 2600,
    });
    return;
  }

  openHandoffDialog(plan, {
    onContinue: () => {
      continueConversationWithProvider(targetProviderId);
    },
    onNewChat: () => {
      startNewChatWithProvider(targetProviderId);
    },
    onCancel: () => {
      // Nothing changed: the provider select is still on the original provider.
    },
  });
}

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
}

function renderComposerState() {
  const input = qs('#composer-input');
  const send = qs('#send-btn');
  const hasText = input.value.trim().length > 0;

  // Typing always means "send". The stop control only takes over the button
  // while the composer is empty, so a background reply can never swallow a
  // message the user is in the middle of writing.
  if (hasText) {
    send.disabled = false;
    send.innerHTML = icon('send', 18);
    send.setAttribute('aria-label', 'Send message');
    send.dataset.mode = 'send';
  } else if (pending) {
    send.disabled = false;
    send.innerHTML = icon('close', 16);
    send.setAttribute('aria-label', 'Stop generating');
    send.dataset.mode = 'stop';
  } else {
    send.disabled = true;
    send.innerHTML = icon('send', 18);
    send.setAttribute('aria-label', 'Send message');
    send.dataset.mode = 'send';
  }
}

function patchStreamNode(text) {
  const bubble = qs('[data-stream-bubble]');
  if (!bubble) return;
  bubble.innerHTML = renderRichText(text);
  scrollMessagesToEnd();
}

function scrollMessagesToEnd(behavior = 'auto') {
  const box = qs('#messages');
  if (box) box.scrollTo({ top: box.scrollHeight, behavior });
}

const ERROR_PRESENTATION = {
  rate_limit: {
    title: 'Provider rate limit reached',
    message: 'The AI provider refused the request because too many were sent in a short time.',
  },
  timeout: {
    title: 'The provider timed out',
    message: 'We waited for the reply but the provider did not respond in time.',
  },
  network: {
    title: 'Could not reach the provider',
    message: 'The request never left the machine, or the connection dropped.',
  },
  invalid: {
    title: 'Unreadable provider response',
    message: 'The provider replied, but the payload was not in the expected format.',
  },
};

function describeError(error, provider) {
  const base = ERROR_PRESENTATION[error.kind] || {
    title: 'Something went wrong',
    message: error.message,
  };
  return {
    ...base,
    hint: error.hint || `Provider: ${provider?.name || 'unknown'}`,
  };
}

async function handleSend(text) {
  if (pending) return;

  const state = getState();
  let conversation = selectActiveConversation(state);
  if (!conversation) conversation = createConversation(state.activeProviderId);

  const providerId = conversation.providerId;
  const input = qs('#composer-input');
  input.value = '';
  autoGrow(input);

  pending = { conversationId: conversation.id, providerId, text: '', error: null };
  renderMessages(getState());
  renderComposerState();
  scrollMessagesToEnd();

  try {
    await sendMessage(text, {
      onStream: (partial) => {
        if (!pending) return;
        pending.text = partial;
        patchStreamNode(partial);
      },
    });
    pending = null;
    renderMessages(getState());
    renderComposerState();
    scrollMessagesToEnd('smooth');
  } catch (error) {
    pending = {
      conversationId: conversation.id,
      providerId,
      text: '',
      error: describeError(error, selectProvider(providerId)),
    };
    renderMessages(getState());
    renderComposerState();
    scrollMessagesToEnd('smooth');
  }
}

async function handleRetry() {
  if (!pending) return;
  const { conversationId } = pending;
  pending = { ...pending, text: '', error: null };
  renderMessages(getState());
  renderComposerState();

  try {
    await runAssistantReply({
      conversationId,
      onStream: (partial) => {
        if (!pending) return;
        pending.text = partial;
        patchStreamNode(partial);
      },
    });
    pending = null;
    renderMessages(getState());
    renderComposerState();
    scrollMessagesToEnd('smooth');
    showToast({ type: 'success', title: 'Reply received', timeout: 2200 });
  } catch (error) {
    pending.error = describeError(error, selectProvider(pending.providerId));
    renderMessages(getState());
    renderComposerState();
  }
}

function handleStop() {
  stopResponding();
  pending = null;
  renderMessages(getState());
  renderComposerState();
  showToast({ type: 'info', title: 'Stopped generating', timeout: 2200 });
}

function initComposer() {
  const form = qs('#composer');
  const input = qs('#composer-input');

  input.addEventListener('input', () => {
    autoGrow(input);
    renderComposerState();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) handleSend(text);
    else if (pending) handleStop();
  });

  // Click targets inside message bubbles (copy, retry) and starter prompts.
  qs('#messages').addEventListener('click', async (event) => {
    const prompt = event.target.closest('[data-prompt]');
    if (prompt) {
      handleSend(prompt.dataset.prompt);
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      const ok = await copyText(copy.dataset.copy);
      showToast({
        type: ok ? 'success' : 'error',
        title: ok ? 'Copied to clipboard' : 'Could not copy',
        timeout: 2000,
      });
      return;
    }
    if (event.target.closest('[data-retry]')) handleRetry();
    if (event.target.closest('[data-save-error]')) {
      showToast({
        type: 'info',
        title: 'Error kept in the chat view',
        message: 'The backend will persist failed turns in Milestone 5.',
        timeout: 3000,
      });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Header actions                                                      */
/* ------------------------------------------------------------------ */

function initHeaderActions() {
  qs('#export-chat').addEventListener('click', () => {
    const conversation = selectActiveConversation();
    if (!conversation) {
      showToast({ type: 'warning', title: 'Nothing to export' });
      return;
    }
    exportConversation(conversation);
  });

  qs('#clear-chat').addEventListener('click', async () => {
    const conversation = selectActiveConversation();
    if (!conversation || conversation.messages.length === 0) {
      showToast({ type: 'info', title: 'This conversation is already empty' });
      return;
    }
    const confirmed = await confirmDialog({
      title: 'Clear this conversation?',
      description: `All ${conversation.messages.length} message(s) in “${conversation.title}” will be removed. The conversation itself stays in the list.`,
      confirmLabel: 'Clear messages',
      variant: 'danger',
      iconName: 'trash',
    });
    if (confirmed) {
      clearConversation(conversation.id);
      showToast({ type: 'success', title: 'Conversation cleared' });
    }
  });

  // Double-click the title to rename (desktop shortcut).
  qs('#chat-title').addEventListener('dblclick', () => {
    const conversation = selectActiveConversation();
    if (conversation) startRename(conversation);
  });
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function initChat() {
  initComposer();
  initHeaderActions();
  renderComposerState();
}

export function renderChat(state) {
  renderHeader(state);
  renderMessages(state);
  renderComposerState();
  const box = qs('#messages');
  if (box) box.scrollTop = box.scrollHeight;
}

/** Used by the smoke test and by the "demo" shortcut in the empty state. */
export function chatInternals() {
  return {
    get pending() {
      return pending;
    },
    send: handleSend,
    retry: handleRetry,
    stop: handleStop,
    renderLoadingSkeleton: () => {
      qs('#messages-inner').innerHTML = loadingSkeleton();
    },
  };
}
