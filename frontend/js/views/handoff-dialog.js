/**
 * views/handoff-dialog.js — the "Continue this conversation with X?" dialog.
 *
 * This is the centrepiece of the project. The dialog is also where we explain
 * the architecture honestly: the application database is the single source of
 * truth, and the context is assembled by the app before it is sent to the new
 * provider. Providers never talk to each other.
 */

import { el, esc, icon, renderRichText, truncate } from '../utils.js';
import { openDialog } from '../ui.js';

function providerChip(provider) {
  return el('span', { class: 'handoff__pill' }, [
    el('span', {
      class: 'provider-trigger__logo',
      style: { '--provider-hue': provider.accent },
      text: provider.shortName,
    }),
    el('strong', { text: provider.name }),
  ]);
}

function previewList(plan) {
  return el('div', { class: 'handoff-preview' }, [
    el('p', { class: 'handoff-preview__label', text: 'Context that will be transferred' }),
    el('div', { class: 'handoff-preview__list' },
      plan.preview.map((message) =>
        el('div', { class: 'handoff-preview__item' }, [
          el('span', { class: 'handoff-preview__from', text: message.type === 'user' ? 'You' : plan.from.name }),
          el('span', {
            class: 'handoff-preview__text',
            text: truncate(renderRichText(message.content).replace(/<[^>]+>/g, ' '), 110),
          }),
        ])
      )
    ),
  ]);
}

/**
 * @param {object} plan           result of actions.planProviderSwitch()
 * @param {object} handlers       { onContinue, onNewChat, onCancel }
 */
export function openHandoffDialog(plan, { onContinue, onNewChat, onCancel }) {
  // The dialog can fire onClose after an action's onClick, so every handler
  // must run at most once.
  let settled = false;
  const once = (fn) => (payload) => {
    if (settled) return;
    settled = true;
    fn?.(payload);
  };

  const handleContinue = once(onContinue);
  const handleNewChat = once(onNewChat);
  const handleCancel = once(onCancel);

  const flow = el('div', { class: 'handoff-flow' }, [
    el('span', { class: 'handoff-flow__node' }, [
      el('span', {
        class: 'provider-trigger__logo',
        style: { '--provider-hue': plan.from.accent },
        text: plan.from.shortName,
      }),
      el('span', { text: plan.from.name }),
    ]),
    el('span', { class: 'handoff-flow__arrow', 'aria-hidden': 'true' }),
    el('span', { class: 'handoff-flow__node' }, [
      el('span', {
        class: 'provider-trigger__logo',
        style: { '--provider-hue': plan.to.accent },
        text: plan.to.shortName,
      }),
      el('span', { text: plan.to.name }),
    ]),
  ]);

  const body = el('div', {}, [
    el('div', { class: 'notice notice--info', style: { marginBottom: 'var(--space-3)' } }, [
      el('span', { class: 'notice__icon', html: icon('info', 16) }),
      el('span', {
        html: `<strong>${esc(plan.to.name)}</strong> has no access to this conversation.
               Ytalks reads the ${plan.messageCount} earlier message${plan.messageCount === 1 ? '' : 's'} from
               its own database and sends ${plan.messageCount === 1 ? 'it' : 'them'} to ${esc(plan.to.name)} as context.
               The previous provider is never contacted.`,
      }),
    ]),
    flow,
    previewList(plan),
  ]);

  const controller = openDialog({
    title: `Continue this conversation with ${plan.to.name}?`,
    description: `You have ${plan.messageCount} message${
      plan.messageCount === 1 ? '' : 's'
    } in this chat, currently on ${plan.from.name}.`,
    iconName: 'arrows',
    wide: true,
    stack: true,
    body,
    autofocus: '#handoff-continue',
    onClose: handleCancel,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: handleCancel },
      { label: 'Start new chat', variant: 'secondary', onClick: handleNewChat },
      { id: 'handoff-continue', label: 'Continue conversation', variant: 'primary', onClick: handleContinue },
    ],
  });

  return controller;
}
