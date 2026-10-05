/**
 * views/settings.js — the settings dialog.
 *
 * Everything on this screen is prototype-only: theme, simulated provider
 * latency and the failure simulation used to demo error states.
 */

import { el, qs, esc } from '../utils.js';
import { openDialog, confirmDialog, showToast } from '../ui.js';
import { getState, selectStats } from '../store.js';
import { resetDemoData, setSettings, setTheme } from '../actions.js';

const ERROR_MODES = [
  { value: 'none', label: 'No errors (normal demo)' },
  { value: 'rate_limit', label: 'Rate limit (HTTP 429)' },
  { value: 'timeout', label: 'Timeout' },
  { value: 'network', label: 'Network failure' },
  { value: 'invalid', label: 'Invalid provider response' },
];

function labelledField(labelText, control, hint) {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field__label', text: labelText }),
    control,
    hint ? el('p', { class: 'field__hint', text: hint }) : null,
  ]);
}

function switchRow(title, description, checked, onChange) {
  const button = el('button', {
    class: 'switch',
    role: 'switch',
    type: 'button',
    'aria-checked': String(checked),
    'aria-label': title,
  });
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return el('div', { class: 'switch-row' }, [
    el('div', { class: 'switch-row__text' }, [
      el('p', { class: 'switch-row__title', text: title }),
      el('p', { class: 'switch-row__desc', text: description }),
    ]),
    button,
  ]);
}

function buildBody() {
  const state = getState();
  const settings = state.settings;
  const stats = selectStats(state);

  /* ---- Appearance ---- */
  const themeGroup = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Theme' });
  for (const theme of ['dark', 'light']) {
    const option = el('button', {
      class: 'segmented__option',
      type: 'button',
      text: theme === 'dark' ? 'Dark' : 'Light',
      'aria-pressed': String(settings.theme === theme),
    });
    option.addEventListener('click', () => {
      setTheme(theme);
      themeGroup.querySelectorAll('.segmented__option').forEach((node) => {
        node.setAttribute('aria-pressed', String(node === option));
      });
    });
    themeGroup.append(option);
  }

  /* ---- Simulated latency ---- */
  const latencyValue = el('p', {
    class: 'field__hint',
    text: `${settings.mockLatencyMs} ms base delay`,
  });
  const latency = el('input', {
    class: 'range',
    type: 'range',
    min: '0',
    max: '3000',
    step: '100',
    value: String(settings.mockLatencyMs),
    'aria-label': 'Simulated provider latency',
  });
  latency.addEventListener('input', () => {
    const value = Number(latency.value);
    latencyValue.textContent = `${value} ms base delay`;
    setSettings({ mockLatencyMs: value });
  });

  /* ---- Failure simulation ---- */
  const errorSelect = el('select', { class: 'input', 'aria-label': 'Simulated failure mode' });
  for (const mode of ERROR_MODES) {
    errorSelect.append(el('option', { value: mode.value, text: mode.label, selected: mode.value === settings.mockErrorMode }));
  }
  errorSelect.addEventListener('change', () => {
    setSettings({ mockErrorMode: errorSelect.value });
    showToast({
      type: errorSelect.value === 'none' ? 'info' : 'warning',
      title: 'Failure simulation updated',
      message:
        errorSelect.value === 'none'
          ? 'The next message will succeed.'
          : 'The next message will fail — this is how the error state is demonstrated.',
      timeout: 3200,
    });
  });

  /* ---- Stats ---- */
  const statGrid = el('div', { class: 'stat-grid' }, [
    el('div', { class: 'stat' }, [
      el('p', { class: 'stat__value', text: String(stats.conversations) }),
      el('p', { class: 'stat__label', text: 'Chats' }),
    ]),
    el('div', { class: 'stat' }, [
      el('p', { class: 'stat__value', text: String(stats.messages) }),
      el('p', { class: 'stat__label', text: 'Messages' }),
    ]),
    el('div', { class: 'stat' }, [
      el('p', { class: 'stat__value', text: String(stats.handoffs) }),
      el('p', { class: 'stat__label', text: 'Handoffs' }),
    ]),
    el('div', { class: 'stat' }, [
      el('p', { class: 'stat__value', text: String(stats.providers) }),
      el('p', { class: 'stat__label', text: 'Providers' }),
    ]),
  ]);

  const body = el('div', {}, [
    el('section', { class: 'settings-group' }, [
      el('h3', { class: 'settings-group__title', text: 'Appearance' }),
      themeGroup,
    ]),

    el('section', { class: 'settings-group' }, [
      el('h3', { class: 'settings-group__title', text: 'Mock provider behaviour' }),
      el('p', {
        class: 'field__hint',
        style: { marginBottom: 'var(--space-3)' },
        text: 'No AI provider is called yet. These controls only shape the fake reply used in this prototype.',
      }),
      labelledField('Simulated latency', latency),
      latencyValue,
      el('div', { style: { height: 'var(--space-4)' } }),
      labelledField(
        'Simulated failure',
        errorSelect,
        'Choose a failure to see how the UI handles rate limits, timeouts and bad responses.'
      ),
      switchRow('Stream tokens', 'Reveal the reply word by word, like a real provider stream.', settings.streamTokens, (value) =>
        setSettings({ streamTokens: value })
      ),
    ]),

    el('section', { class: 'settings-group' }, [
      el('h3', { class: 'settings-group__title', text: 'Local demo data' }),
      statGrid,
      el('p', {
        class: 'field__hint',
        style: { marginTop: 'var(--space-3)' },
        text: `Stored in this browser only (localStorage key “${esc(
          'ytalks.milestone1.v1'
        )}”). Nothing is uploaded anywhere.`,
      }),
    ]),
  ]);

  return { body, resetButton: null, statGrid };
}

export function openSettingsDialog() {
  const { body } = buildBody();

  openDialog({
    title: 'Settings',
    description: 'Prototype preferences — stored in this browser only.',
    iconName: 'settings',
    wide: true,
    body,
    actions: [
      {
        label: 'Reset demo data',
        variant: 'danger',
        stayOpen: true,
        onClick: async ({ close }) => {
          const confirmed = await confirmDialog({
            title: 'Reset demo data?',
            description:
              'All conversations created in this browser will be deleted and the original sample data restored. You will stay signed in.',
            confirmLabel: 'Reset',
            variant: 'danger',
            iconName: 'trash',
          });
          if (confirmed) {
            resetDemoData();
            close();
            showToast({ type: 'success', title: 'Demo data reset' });
          }
        },
      },
      { label: 'Done', variant: 'primary' },
    ],
  });
}

/** Re-export so the settings view can be opened from anywhere. */
export const settingsButton = () => qs('#open-settings');
