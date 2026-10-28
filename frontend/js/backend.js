/**
 * backend.js — REST client for Ytalks backend.
 * <p>
 * Provides authentication, conversation, and provider APIs.
 * Includes JWT token management and automatic header injection.
 */

const DEFAULT_BASE = 'http://localhost:8080';
const STORAGE_KEY_BASE = 'ytalks.backendBase';
const STORAGE_KEY_TOKEN = 'ytalks.authToken';
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Returns the configured backend base URL.
 */
export function backendBaseUrl() {
  try {
    const override = localStorage.getItem(STORAGE_KEY_BASE);
    if (override && /^https?:\/\//.test(override)) return override.replace(/\/+$/, '');
  } catch {
    /* storage unavailable — fall through to default */
  }
  return DEFAULT_BASE;
}

export function setBackendBaseUrl(url) {
  try {
    if (!url) localStorage.removeItem(STORAGE_KEY_BASE);
    else localStorage.setItem(STORAGE_KEY_BASE, String(url).replace(/\/+$/, ''));
  } catch {
    /* ignore */
  }
}

/**
 * Gets the stored JWT access token.
 */
export function getAuthToken() {
  try {
    return localStorage.getItem(STORAGE_KEY_TOKEN);
  } catch {
    return null;
  }
}

/**
 * Stores the JWT access token.
 */
export function setAuthToken(token) {
  try {
    if (!token) localStorage.removeItem(STORAGE_KEY_TOKEN);
    else localStorage.setItem(STORAGE_KEY_TOKEN, token);
  } catch {
    /* ignore */
  }
}

/**
 * Clears the stored auth token.
 */
export function clearAuthToken() {
  try {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
  } catch {
    /* ignore */
  }
}

/**
 * Checks if user is currently authenticated (has a token).
 */
export function isAuthenticated() {
  return !!getAuthToken();
}

/**
 * Builds standard headers including Authorization if token exists.
 */
function authHeaders(extra = {}) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extra,
  };
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Generic API request helper with timeout and error handling.
 */
async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${backendBaseUrl()}${path}`, {
      ...options,
      headers: authHeaders(options.headers),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const body = isJson ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(body?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = body?.code;
      error.fieldErrors = body?.fieldErrors;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Health                                                             */
/* ------------------------------------------------------------------ */

export async function fetchHealth({ timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${backendBaseUrl()}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: `http-${response.status}` };
    const payload = await response.json();
    if (!payload || payload.status !== 'UP') return { ok: false, reason: 'not-up' };
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Authentication                                                     */
/* ------------------------------------------------------------------ */

export async function register(name, email, phone, password) {
  return apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, phone, password }),
  });
}

export async function registerAndVerify(name, email, phone, password, code) {
  return apiRequest('/api/auth/register/verify', {
    method: 'POST',
    body: JSON.stringify({ name, email, phone, password, code }),
  });
}

export async function resendOtp(email) {
  return apiRequest('/api/auth/resend-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function login(email, password) {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function getCurrentUser() {
  return apiRequest('/api/auth/me', {
    method: 'POST',
  });
}

export async function logout() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } finally {
    clearAuthToken();
  }
}

/* ------------------------------------------------------------------ */
/* Providers                                                          */
/* ------------------------------------------------------------------ */

export async function fetchProviders() {
  return apiRequest('/api/providers', { method: 'GET' });
}

/* ------------------------------------------------------------------ */
/* Conversations                                                      */
/* ------------------------------------------------------------------ */

export async function fetchConversations(page = 0, size = 20) {
  return apiRequest(`/api/conversations?page=${page}&size=${size}`, { method: 'GET' });
}

export async function createConversation(title, providerId, model) {
  return apiRequest('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title, providerId, model }),
  });
}

export async function fetchConversation(id) {
  return apiRequest(`/api/conversations/${id}`, { method: 'GET' });
}

export async function updateConversation(id, title, providerId, model) {
  return apiRequest(`/api/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, providerId, model }),
  });
}

export async function deleteConversation(id) {
  return apiRequest(`/api/conversations/${id}`, { method: 'DELETE' });
}

export async function clearConversation(id) {
  return apiRequest(`/api/conversations/${id}/clear`, { method: 'POST' });
}

export async function fetchMessages(conversationId, page = 0, size = 50) {
  return apiRequest(`/api/conversations/${conversationId}/messages?page=${page}&size=${size}`, { method: 'GET' });
}

export async function addMessage(conversationId, senderType, content, providerId, model) {
  return apiRequest(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderType, content, providerId, model }),
  });
}

export async function sendChatMessage(conversationId, message, providerId, model) {
  return apiRequest(`/api/chat/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message, providerId, model }),
  });
}