/**
 * backend.js — minimal Milestone 2 REST client.
 *
 * Only the health endpoint exists so far. Chat, auth and history stay on the
 * Milestone 1 mock layer; this module purely reports whether the Spring Boot
 * service is reachable so the UI can show a connection badge.
 *
 * The base URL is configurable without a rebuild:
 *   - `localStorage["ytalks.backendBase"]` wins when set (useful for tests),
 *   - otherwise `http://localhost:8080` is used.
 */

const DEFAULT_BASE = 'http://localhost:8080';
const STORAGE_KEY = 'ytalks.backendBase';
const REQUEST_TIMEOUT_MS = 4000;

export function backendBaseUrl() {
  try {
    const override = localStorage.getItem(STORAGE_KEY);
    if (override && /^https?:\/\//.test(override)) return override.replace(/\/+$/, '');
  } catch {
    /* storage unavailable — fall through to default */
  }
  return DEFAULT_BASE;
}

export function setBackendBaseUrl(url) {
  try {
    if (!url) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(url).replace(/\/+$/, ''));
  } catch {
    /* ignore */
  }
}

/**
 * GET /api/health with a timeout. Resolves to
 * `{ ok: true, payload }` or `{ ok: false, reason }` — never throws, so the
 * status badge can render "offline" instead of crashing the app.
 */
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
