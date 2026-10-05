/**
 * views/auth.js — mock login and registration screens.
 *
 * NOTE: there is no real authentication here. Milestone 4 replaces the
 * `login`/`register` calls in actions.js with real REST calls; this view only
 * deals with the form, validation and the loading state.
 */

import { qs, qsa, clamp } from '../utils.js';
import { showToast } from '../ui.js';
import { DEMO_CREDENTIALS } from '../mock-data.js';
import { login, register } from '../actions.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * Show or clear a validation message.
 * The DOM ids in index.html are prefixed per form (login-email,
 * register-email), so we match on the field name at the end of the attribute.
 */
function setFieldError(form, fieldName, message) {
  const input = form.elements[fieldName];
  const errorNode = form.querySelector(
    `[data-error-for="${fieldName}"], [data-error-for$="-${fieldName}"]`
  );
  if (!errorNode) return;

  if (message) {
    const span = errorNode.querySelector('span');
    if (span) span.textContent = message;
    else errorNode.textContent = message;
    errorNode.hidden = false;
    input?.setAttribute('aria-invalid', 'true');
  } else {
    errorNode.hidden = true;
    input?.removeAttribute('aria-invalid');
  }
}

function setFormError(form, message) {
  const node = form.querySelector('[data-error-for$="-form"]');
  if (!node) return;
  if (message) {
    const span = node.querySelector('span');
    if (span) span.textContent = message;
    node.hidden = false;
  } else {
    node.hidden = true;
  }
}

function setBusy(form, busy, label) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  button.dataset.idleLabel = button.dataset.idleLabel || button.textContent.trim();
  if (busy) {
    button.textContent = label;
  } else {
    button.textContent = button.dataset.idleLabel;
  }
}

/* ------------------------------------------------------------------ */
/* Password strength (visual only — no hashing happens in the browser) */
/* ------------------------------------------------------------------ */

function scorePassword(value) {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return clamp(score, 0, 4);
}

function paintStrength(value) {
  const score = scorePassword(value);
  const bars = qsa('.strength__bar');
  const label = qs('#password-strength-label');

  bars.forEach((bar, index) => {
    bar.className = 'strength__bar';
    if (index < score) {
      bar.classList.add(score <= 1 ? 'is-on-weak' : score === 2 ? 'is-on-medium' : 'is-on-strong');
    }
  });

  if (label) {
    label.textContent = [
      'Too short — use at least 8 characters',
      'Weak password',
      'Decent, add a number or symbol',
      'Good password',
      'Strong password',
    ][score];
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function validateLogin(form) {
  let ok = true;
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;

  if (!email) {
    setFieldError(form, 'email', 'Email is required.');
    ok = false;
  } else if (!EMAIL_RE.test(email)) {
    setFieldError(form, 'email', 'Enter a valid email address.');
    ok = false;
  } else setFieldError(form, 'email', '');

  if (!password) {
    setFieldError(form, 'password', 'Password is required.');
    ok = false;
  } else if (password.length < 8) {
    setFieldError(form, 'password', 'Password must be at least 8 characters.');
    ok = false;
  } else setFieldError(form, 'password', '');

  return ok;
}

function validateRegister(form) {
  let ok = true;
  const name = form.elements.name.value.trim();
  const email = form.elements.email.value.trim();
  const phone = form.elements.phone.value.trim();
  const password = form.elements.password.value;

  if (name.length < 2) {
    setFieldError(form, 'name', 'Please enter your full name.');
    ok = false;
  } else setFieldError(form, 'name', '');

  if (!EMAIL_RE.test(email)) {
    setFieldError(form, 'email', 'Enter a valid email address.');
    ok = false;
  } else setFieldError(form, 'email', '');

  if (phone && !/^[+\d][\d\s-]{7,17}$/.test(phone)) {
    setFieldError(form, 'phone', 'Enter a valid phone number or leave it blank.');
    ok = false;
  } else setFieldError(form, 'phone', '');

  if (password.length < 8) {
    setFieldError(form, 'password', 'Use at least 8 characters.');
    ok = false;
  } else setFieldError(form, 'password', '');

  return ok;
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

export function initAuthScreen() {
  const loginForm = qs('#login-form');
  const registerForm = qs('#register-form');

  // Clear a field's error as soon as the user starts fixing it.
  qsa('input').forEach((input) => {
    input.addEventListener('input', () => {
      const form = input.closest('form');
      if (!form) return;
      const name = input.name;
      setFieldError(form, name, '');
      if (form === loginForm || form === registerForm) setFormError(form, '');
    });
  });

  qsa('[data-toggle-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = qs(`#${button.dataset.togglePassword}`);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus();
    });
  });

  qs('#register-password')?.addEventListener('input', (event) => {
    paintStrength(event.target.value);
  });

  qsa('[data-goto-auth]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.gotoAuth;
      showScreen(target);
      requestAnimationFrame(() =>
        qs(`#${target}-form input`)?.focus()
      );
    });
  });

  qs('#fill-demo-login')?.addEventListener('click', () => {
    loginForm.elements.email.value = DEMO_CREDENTIALS.email;
    loginForm.elements.password.value = DEMO_CREDENTIALS.password;
    setFieldError(loginForm, 'email', '');
    setFieldError(loginForm, 'password', '');
    showToast({
      type: 'info',
      title: 'Demo credentials filled',
      message: 'Press “Sign in” to enter the prototype.',
      timeout: 3000,
    });
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateLogin(loginForm)) return;

    setFormError(loginForm, '');
    setBusy(loginForm, true, loginForm.querySelector('button[type="submit"]').dataset.submitLabel);

    try {
      const user = await login({
        email: loginForm.elements.email.value,
        password: loginForm.elements.password.value,
      });
      showToast({ type: 'success', title: `Welcome back, ${user.name.split(' ')[0]}`, message: 'Signed in to the local demo session.' });
      loginForm.reset();
    } catch (error) {
      setFormError(loginForm, error.message);
    } finally {
      setBusy(loginForm, false);
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateRegister(registerForm)) return;

    setFormError(registerForm, '');
    setBusy(registerForm, true, registerForm.querySelector('button[type="submit"]').dataset.submitLabel);

    try {
      const user = await register({
        name: registerForm.elements.name.value,
        email: registerForm.elements.email.value,
        phone: registerForm.elements.phone.value,
      });
      showToast({
        type: 'success',
        title: `Account created for ${user.name.split(' ')[0]}`,
        message: 'Mock registration only — nothing was sent to a server.',
      });
      registerForm.reset();
      paintStrength('');
    } catch (error) {
      setFormError(registerForm, error.message);
    } finally {
      setBusy(registerForm, false);
    }
  });
}

/** Show either the login or the register form. */
export function showScreen(name) {
  qs('#login-form').hidden = name !== 'login';
  qs('#register-form').hidden = name !== 'register';
  document.querySelector('.auth__card')?.setAttribute(
    'data-view',
    name
  );
}

export function renderAuthScreen() {
  /* The forms are static; only visibility depends on state. */
}
