/**
 * views/sidebar.js — conversation list, search, new chat, user profile menu.
 */

import { qs, el, esc, icon, initials, shortAge, dayGroupLabel, downloadFile } from '../utils.js';
import { openMenu, openDialog, confirmDialog, showToast } from '../ui.js';
import {
  createConversation,
  deleteConversation,
  duplicateConversation,
  renameConversation,
  selectConversation,
  setSearchQuery,
  logout,
} from '../actions.js';
import { getState, selectVisibleConversations, selectProvider } from '../store.js';
import { openSettingsDialog } from './settings.js';

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function conversationRow(conversation, isActive) {
  const used = [
    ...new Set(
      conversation.messages.filter((m) => m.type === 'assistant').map((m) => m.providerId)
    ),
  ];
  const shown = used.length ? used : [conversation.providerId];

  const lastMessage = [...conversation.messages]
    .reverse()
    .find((m) => m.type !== 'handoff');
  const preview = lastMessage
    ? lastMessage.type === 'user'
      ? `You: ${lastMessage.content}`
      : lastMessage.content
    : 'Empty conversation';

  return `
    <div class="conv${isActive ? ' is-active' : ''}"
         data-conversation-id="${esc(conversation.id)}"
         data-provider="${esc(conversation.providerId)}"
         role="listitem"
         tabindex="0"
         aria-current="${isActive ? 'true' : 'false'}">
      <span class="conv__icon" aria-hidden="true">${icon('sparkles', 15)}</span>
      <span class="conv__body">
        <span class="conv__title truncate" title="${esc(conversation.title)}">${esc(conversation.title)}</span>
        <span class="conv__preview truncate">${esc(preview)}</span>
        <span class="conv__meta">
          <span class="conv__providers" title="Providers used: ${esc(shown.join(', '))}">
            ${shown
              .map(
                (id) =>
                  `<span class="provider-dot" style="--provider-hue:${esc(
                    selectProvider(id)?.accent || '#888888'
                  )}"></span>`
              )
              .join('')}
          </span>
          <span class="conv__time">${esc(shortAge(conversation.updatedAt))}</span>
        </span>
      </span>
      <button class="conv__menu-btn" data-conv-menu="${esc(conversation.id)}"
              aria-label="Actions for ${esc(conversation.title)}"
              aria-haspopup="menu" aria-expanded="false">${icon('more', 15)}</button>
    </div>`;
}

function renderList(state) {
  const list = selectVisibleConversations(state);
  const container = qs('#conversation-list');

  if (list.length === 0) {
    const searching = state.ui.searchQuery.trim().length > 0;
    container.innerHTML = `
      <div class="state">
        <span class="state__icon" aria-hidden="true">${icon(searching ? 'search' : 'sparkles', 24)}</span>
        <p class="state__title">${searching ? 'No matches' : 'No conversations yet'}</p>
        <p class="state__text">${
          searching
            ? 'Try a different word, or clear the search box.'
            : 'Start a new chat and it will appear here.'
        }</p>
      </div>`;
    return;
  }

  // Group by day so a long history stays scannable.
  const groups = [];
  for (const conversation of list) {
    const label = dayGroupLabel(conversation.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(conversation);
    else groups.push({ label, items: [conversation] });
  }

  container.innerHTML = groups
    .map(
      (group) => `
        <div role="presentation">
          <p class="group-label">${esc(group.label)}</p>
          ${group.items.map((c) => conversationRow(c, c.id === state.activeConversationId)).join('')}
        </div>`
    )
    .join('');
}

function renderUser(state) {
  const user = state.session.user;
  if (!user) return;
  qs('#user-name').textContent = user.name;
  qs('#user-email').textContent = user.email;
  const avatar = qs('#user-avatar');
  avatar.textContent = initials(user.name);
  avatar.title = user.name;
}

/* ------------------------------------------------------------------ */
/* Conversation operations                                             */
/* ------------------------------------------------------------------ */

export function startRename(conversation) {
  const input = el('input', {
    class: 'input',
    value: conversation.title,
    maxLength: 80,
    'aria-label': 'Conversation title',
  });

  openDialog({
    title: 'Rename conversation',
    iconName: 'rename',
    body: input,
    autofocus: 'input',
    actions: [
      { label: 'Cancel', variant: 'secondary' },
      {
        label: 'Save',
        variant: 'primary',
        onClick: () => {
          if (!input.value.trim()) {
            showToast({ type: 'warning', title: 'Title cannot be empty' });
            return false; // keep the dialog open
          }
          renameConversation(conversation.id, input.value);
          showToast({ type: 'success', title: 'Conversation renamed' });
        },
      },
    ],
  });

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

export function exportConversation(conversation) {
  const lines = [`# ${conversation.title}`, '', `_Exported from the Ytalks Milestone 1 prototype._`, ''];

  for (const message of conversation.messages) {
    if (message.type === 'handoff') {
      lines.push(
        `> **Cross-AI handoff** — ${message.messageCount} messages moved from ${message.fromProviderId} (${message.fromModel}) to ${message.toProviderId} (${message.toModel}).`,
        ''
      );
      continue;
    }
    const who = message.type === 'user' ? 'You' : `${message.providerId} · ${message.model}`;
    lines.push(`**${who}** — ${new Date(message.createdAt).toLocaleString()}`, '', message.content, '');
  }

  downloadFile(`${conversation.title.replace(/[^\w-]+/g, '_')}.md`, lines.join('\n'));
  showToast({ type: 'success', title: 'Exported as Markdown', message: conversation.title });
}

/* ------------------------------------------------------------------ */
/* Row actions menu                                                    */
/* ------------------------------------------------------------------ */

function openConversationMenu(anchor, conversationId) {
  const conversation = getState().conversations.find((c) => c.id === conversationId);
  if (!conversation) return;

  const item = (label, iconName, onClick, danger = false) =>
    el(
      'button',
      { class: `menu__item${danger ? ' menu__item--danger' : ''}`, role: 'menuitem', onclick: onClick },
      [
        el('span', { class: 'menu__label', text: label }),
        el('span', { html: icon(iconName, 15) }),
      ]
    );

  openMenu(
    anchor,
    ({ close }) => {
      const menu = el('div', { role: 'menu' });
      menu.append(
        el('p', { class: 'menu__section-label', text: 'Conversation' }),
        item('Rename', 'rename', () => {
          close();
          startRename(conversation);
        }),
        item('Duplicate', 'copy', () => {
          close();
          duplicateConversation(conversation.id);
          showToast({ type: 'success', title: 'Conversation duplicated' });
        }),
        item('Export as Markdown', 'download', () => {
          close();
          exportConversation(conversation);
        })
      );
      menu.append(el('div', { class: 'menu__separator' }));
      menu.append(
        item(
          'Delete',
          'trash',
          async () => {
            close();
            const confirmed = await confirmDialog({
              title: 'Delete this conversation?',
              description: `“${conversation.title}” and its ${conversation.messages.length} message(s) will be removed from this browser. This cannot be undone.`,
              confirmLabel: 'Delete',
              variant: 'danger',
              iconName: 'trash',
            });
            if (confirmed) {
              deleteConversation(conversation.id);
              showToast({ type: 'info', title: 'Conversation deleted' });
            }
          },
          true
        )
      );
      return menu;
    },
    { align: 'end' }
  );
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

export function initSidebar() {
  qs('#new-chat').addEventListener('click', () => createConversation());

  qs('#conversation-search').addEventListener('input', (event) =>
    setSearchQuery(event.target.value)
  );

  // Delegated handlers because rows are re-rendered on every state change.
  const list = qs('#conversation-list');
  list.addEventListener('click', (event) => {
    const menuButton = event.target.closest('[data-conv-menu]');
    if (menuButton) {
      event.stopPropagation();
      openConversationMenu(menuButton, menuButton.dataset.convMenu);
      return;
    }
    const row = event.target.closest('[data-conversation-id]');
    if (row) selectConversation(row.dataset.conversationId);
  });

  list.addEventListener('keydown', (event) => {
    const row = event.target.closest('[data-conversation-id]');
    if (!row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectConversation(row.dataset.conversationId);
    }
  });

  qs('#user-chip').addEventListener('click', (event) => {
    openMenu(
      event.currentTarget,
      ({ close }) => {
        const menu = el('div', { role: 'menu' });
        const user = getState().session.user;

        menu.append(
          el('p', { class: 'menu__section-label', text: user ? user.email : 'Signed in' }),
          el('button', { class: 'menu__item', role: 'menuitem', onclick: () => { close(); openSettingsDialog(); } }, [
            el('span', { class: 'menu__label', text: 'Settings' }),
            el('span', { html: icon('settings', 15) }),
          ])
        );
        menu.append(el('div', { class: 'menu__separator' }));
        menu.append(
          el('button', { class: 'menu__item menu__item--danger', role: 'menuitem', onclick: async () => {
            close();
            const confirmed = await confirmDialog({
              title: 'Sign out?',
              description:
                'This prototype stores demo data in your browser only, so you can sign back in and the conversations will still be here.',
              confirmLabel: 'Sign out',
              cancelLabel: 'Stay',
              variant: 'danger',
              iconName: 'log-out',
            });
            if (confirmed) {
              logout();
              showToast({ type: 'info', title: 'Signed out' });
            }
          } }, [
            el('span', { class: 'menu__label', text: 'Sign out' }),
            el('span', { html: icon('log-out', 15) }),
          ])
        );
        return menu;
      },
      { align: 'start' }
    );
  });
}

export function renderSidebar(state) {
  renderList(state);
  renderUser(state);
  const search = qs('#conversation-search');
  if (search.value !== state.ui.searchQuery) search.value = state.ui.searchQuery;
}
