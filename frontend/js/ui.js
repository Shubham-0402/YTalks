/**
 * ui.js — reusable interface primitives: toasts, dialogs, confirmations and
 * popover menus. Views compose these instead of hand-rolling overlays.
 */

import { qs, el, icon, trapFocus } from './utils.js';

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

const TOAST_ICONS = {
  success: 'check',
  error: 'alert',
  warning: 'alert',
  info: 'info',
};

export function showToast({ type = 'info', title, message = '', timeout = 4200 } = {}) {
  const root = qs('#toast-root');
  if (!root) return;

  const node = el('div', { class: `toast toast--${type}` }, [
    el('span', { class: 'toast__icon', html: icon(TOAST_ICONS[type] || 'info', 18) }),
    el('div', { class: 'toast__content' }, [
      el('p', { class: 'toast__title', text: title }),
      message ? el('p', { class: 'toast__message', text: message }) : null,
    ]),
    el('button', {
      class: 'icon-btn toast__close',
      'aria-label': 'Dismiss notification',
      html: icon('close', 14),
      onclick: () => dismiss(),
    }),
  ]);

  let timer;
  function dismiss() {
    clearTimeout(timer);
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  }

  root.append(node);
  if (timeout > 0) timer = setTimeout(dismiss, timeout);
  return dismiss;
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

let openDialogCount = 0;

/**
 * Open a modal dialog.
 *
 * @param {object}   options
 * @param {string}   options.title
 * @param {string}   [options.description]
 * @param {string}   [options.iconName]  sprite icon id
 * @param {Node}     [options.body]      extra content
 * @param {Array}    [options.actions]   [{ label, variant, onClick, autofocus, stayOpen }]
 * @param {boolean}  [options.wide]
 * @param {function} [options.onClose]
 * @param {string}   [options.autofocus]  'first' | 'cancel' | 'confirm' | selector
 * @returns {{close: function, dialog: HTMLElement, setBody: function}}
 */
export function openDialog({
  title,
  description = '',
  iconName = '',
  body = null,
  actions = [],
  wide = false,
  stack = false,
  onClose = null,
  autofocus = 'first',
  dismissible = true,
} = {}) {
  const root = qs('#dialog-root');
  const previouslyFocused = document.activeElement;

  const titleId = `dlg-title-${Date.now().toString(36)}`;
  const descId = `${titleId}-desc`;

  const titleNode = el('h2', { class: 'dialog__title', id: titleId, text: title });
  const descNode = description
    ? el('p', { class: 'dialog__description', id: descId, text: description })
    : null;

  const header = el('div', { class: 'dialog__header' }, [
    iconName ? el('span', { class: 'dialog__icon', html: icon(iconName, 20) }) : null,
    el('div', {}, [titleNode, descNode]),
    dismissible
      ? el('button', {
          class: 'icon-btn dialog__close',
          'aria-label': 'Close dialog',
          html: icon('close', 18),
          onclick: () => close(),
        })
      : null,
  ]);

  const bodyNode = el('div', { class: 'dialog__body' });
  if (body) bodyNode.append(body);
  const footer = el('div', {
    class: `dialog__footer${stack ? ' dialog__footer--stack' : ''}`,
  });

  const dialog = el('div', {
    class: `dialog${wide ? ' dialog--wide' : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    ...(descNode ? { 'aria-describedby': descId } : {}),
  });

  if (body) dialog.append(header, bodyNode);
  else dialog.append(header);
  if (actions.length) dialog.append(footer);

  const scrim = el('div', { class: 'scrim' }, [dialog]);
  if (dismissible) scrim.addEventListener('mousedown', (e) => e.target === scrim && close());

  const actionButtons = actions.map((action) => {
    const button = el('button', {
      class: `btn btn--${action.variant || 'secondary'}`,
      type: 'button',
      text: action.label,
      onclick: async () => {
        if (action.autofocus) button.dataset.autofocus = 'true';
        const result = action.onClick ? await action.onClick({ close, dialog }) : undefined;
        if (!action.stayOpen && result !== false) close();
      },
      ...(action.disabled ? { disabled: true } : {}),
    });
    if (action.id) button.id = action.id;
    footer.append(button);
    return button;
  });

  const releaseTrap = trapFocus(dialog);

  function onKeydown(event) {
    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      close();
    }
  }
  dialog.addEventListener('keydown', onKeydown);

  function close() {
    if (!scrim.isConnected) return;
    releaseTrap();
    scrim.remove();
    openDialogCount = Math.max(0, openDialogCount - 1);
    document.removeEventListener('keydown', onKeydown, true);
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    onClose?.();
  }

  root.append(scrim);
  openDialogCount += 1;

  // Focus the requested control once the entry animation has started.
  requestAnimationFrame(() => {
    const preferred =
      typeof autofocus === 'string' && autofocus !== 'first'
        ? dialog.querySelector(autofocus.startsWith('#') || autofocus.startsWith('.') ? autofocus : `[data-autofocus]`)
        : null;
    const target =
      preferred || actionButtons.find((b) => b.dataset.autofocus === 'true') || dialog.querySelector('button, input, textarea, [tabindex]');
    target?.focus();
  });

  return {
    close,
    dialog,
    scrim,
    setBody(node) {
      const current = dialog.querySelector('.dialog__body');
      if (current) {
        current.replaceChildren(node);
      } else {
        dialog.insertBefore(node, footer);
      }
    },
  };
}

/** Promise-based confirmation. Resolves true when the action is chosen. */
export function confirmDialog({
  title,
  description = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  iconName = 'alert',
  body = null,
  autofocus = 'cancel',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openDialog({
      title,
      description,
      iconName,
      body,
      stack: true,
      autofocus,
      onClose: () => settle(false),
      actions: [
        {
          label: cancelLabel,
          variant: 'secondary',
          onClick: () => settle(false),
        },
        {
          label: confirmLabel,
          variant,
          onClick: () => settle(true),
        },
      ],
    });
  });
}

/* ------------------------------------------------------------------ */
/* Popover menus                                                       */
/* ------------------------------------------------------------------ */

let activeMenu = null;

export function closeActiveMenu() {
  if (!activeMenu) return;
  const { node, anchor, onClose } = activeMenu;
  activeMenu = null;
  document.removeEventListener('mousedown', onDocumentDown, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
  window.removeEventListener('resize', closeActiveMenu);
  window.removeEventListener('scroll', closeActiveMenu, true);
  anchor?.setAttribute('aria-expanded', 'false');
  node.remove();
  onClose?.();
}

function onDocumentDown(event) {
  if (!activeMenu) return;
  if (activeMenu.node.contains(event.target) || activeMenu.anchor?.contains(event.target)) return;
  closeActiveMenu();
}

function onDocumentKeydown(event) {
  if (event.key === 'Escape' && activeMenu) {
    event.stopPropagation();
    const anchor = activeMenu.anchor;
    closeActiveMenu();
    anchor?.focus();
  }
}

/**
 * Open a popover menu anchored to an element.
 * `build({ close })` returns the menu content.
 */
export function openMenu(anchor, build, { align = 'start', gap = 6 } = {}) {
  if (activeMenu?.anchor === anchor) {
    closeActiveMenu();
    return null;
  }
  closeActiveMenu();

  const node = el('div', { class: 'menu', role: 'menu' });
  node.append(build({ close: closeActiveMenu }));

  document.body.append(node);
  anchor.setAttribute('aria-expanded', 'true');

  function position() {
    const rect = anchor.getBoundingClientRect();
    const size = node.getBoundingClientRect();
    const margin = 8;

    let left = align === 'end' ? rect.right - size.width : rect.left;
    left = Math.min(Math.max(margin, left), window.innerWidth - size.width - margin);

    let top = rect.bottom + gap;
    if (top + size.height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - size.height - gap);
    }

    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
  }

  position();
  requestAnimationFrame(position);

  activeMenu = { node, anchor };
  document.addEventListener('mousedown', onDocumentDown, true);
  document.addEventListener('keydown', onDocumentKeydown, true);
  window.addEventListener('resize', closeActiveMenu);
  window.addEventListener('scroll', closeActiveMenu, true);

  node.querySelector('button, [tabindex]')?.focus();
  return node;
}

export const isMenuOpenFor = (anchor) => activeMenu?.anchor === anchor;
