# Ytalks

A multi-AI chat workspace: hold one conversation and move it between OpenAI, Google Gemini,
Anthropic Claude and DeepSeek without losing the thread.

**Status: Milestone 2 complete.** The frontend prototype (Milestone 1) runs on mock data,
plus a Spring Boot REST foundation (`/api/health`) that the frontend polls for a
connection status badge. No database, authentication or real provider calls exist yet.

## Run it

```bash
npm install     # one dev dependency: puppeteer-core (tests only)
npm start       # http://localhost:4173/
```

`npm start` runs a zero-dependency static file server (`tools/serve.js`). Pass a port to override it:
`node tools/serve.js 8080`.

### Backend (Milestone 2)

```bash
cd backend
./mvnw package          # builds target/ytalks-backend-0.2.0.jar (17 tests)
./mvnw spring-boot:run  # http://localhost:8080/api/health
```

`mvnw`/`mvnw.cmd` are the Maven Wrapper — no Maven installation is required (Java 17+ is).
Configuration lives in `backend/src/main/resources/application.yml`; every setting has a
default and can be overridden with an environment variable (`YTALKS_PORT`,
`YTALKS_CORS_ALLOWED_ORIGINS`, …) — see `backend/.env.example`.

The frontend badge in the chat header polls `GET /api/health` every 30s and shows
**connected** or **offline** accordingly. To point the frontend at a different backend:
`localStorage.setItem('ytalks.backendBase', 'http://your-host:8080')`.

### Demo account

| Field    | Value                    |
| -------- | ------------------------ |
| Email    | `aarav.sharma@example.com` |
| Password | `Demo@12345`             |

Signing in is mocked in the browser. The demo email requires the demo password; any other email is
accepted with a password of 8+ characters, and "Create account" validates a new profile locally and
signs you straight in.

## What you can do in Milestone 1

- Sign in / register, with client-side validation and a password strength meter.
- Browse conversation history grouped by day, search it by title **and** message text.
- Open a conversation, send a message, watch a streamed reply arrive, stop it mid-flight, retry a failure.
- Switch provider and model from the composer (OpenAI / Gemini / Claude / DeepSeek).
- **Cross-AI handoff**: switch provider mid-thread and choose to continue the same conversation
  (context is transferred and recorded), start a new chat, or cancel.
- Rename, duplicate, export and delete conversations; clear a single thread.
- Switch dark/light theme, tune the mock latency and error rate, view stats.

State is kept in `localStorage` under `ytalks.milestone1.v1`, so a reload restores the session,
the history and every handoff.

## Look

The interface sits on a fixed, non-interactive cinematic background
(`frontend/css/ambient.css`): four drifting radial glows, a hairline grid
masked to the light sources, film grain and a vignette. Glass surfaces
(sidebar, auth panel, topbar, chat header, composer, cards) sit above it,
and a reading scrim keeps the message column deliberately calm — measured
at ~0.005 mean luminance versus ~0.008 at the edges, so the backdrop never
competes with text. `prefers-reduced-motion` disables the drift, and the
ambient layer is fully re-tokenised for the light theme.

### How the cross-AI handoff behaves

The application owns the history — each conversation is a list of messages tagged with the provider
that produced them, never a per-provider copy.

| Choice                | Result                                                                                |
| --------------------- | ------------------------------------------------------------------------------------- |
| **Continue conversation** | The same thread continues on the new provider. A handoff divider is inserted, context is summarised and the new AI acknowledges the inherited messages. Original messages are untouched. |
| **Start new chat**     | A new, empty conversation opens on the new provider. The previous conversation is left exactly as it was. |
| **Cancel**             | Nothing changes — you stay on the original provider.                                |

## Test

```bash
npm test        # Milestone 1 browser regression — 94/94 checks
npm run test:m2 # Milestone 2 backend + integration — 8 checks
```

`tests/ui-smoke.mjs` drives real Chrome (via `puppeteer-core`, no bundled browser) through the whole
product: auth, messaging, provider switching, both handoff paths, history, persistence across a
reload, error/retry, theming, responsive breakpoints, accessibility basics, a WCAG contrast audit of
both themes, branding/ambient-background verification, and console hygiene. It exits non-zero on
the first failure and writes screenshots of each step to `tests/screenshots/`.

Current result: **94/94 checks passing** (see `docs/milestone-1.md`).

`tests/m2-smoke.mjs` verifies the Milestone 2 chain: `/api/health` answers directly over HTTP,
the browser badge flips to "connected", and the badge degrades to "offline" without page errors
when the backend is unreachable. It expects the backend jar to be running on
`http://localhost:8080` (`cd backend && ./mvnw spring-boot:run`).

`node tests/debug-console.mjs` is a smaller diagnostic that only checks startup and console output.

## Layout

```
frontend/
  index.html              app shell: auth screen, dashboard, dialog roots, SVG icon sprite
  css/tokens.css          design tokens, dark/light themes, per-provider accent hues
  css/ambient.css         cinematic background: glows, grid, grain, vignette
  css/base.css            reset, typography, focus rings, scrollbars, reduced-motion
  css/components.css      buttons, fields, cards, menus, dialogs, toasts, states, skeletons
  css/layout.css          auth, sidebar, chat, composer, provider menu, handoff, settings
  js/utils.js             DOM helper, escaping, dates, rich text, focus trap, downloads
  js/store.js             single state tree, selectors, subscribe, localStorage persistence
  js/mock-data.js         mock user, providers, conversations, starter prompts
  js/mock-ai.js           simulated streaming, topic-aware replies, error modes
  js/actions.js           the only module allowed to mutate state (auth, chat, handoff, history)
  js/backend.js           minimal REST client: /api/health fetch with timeout
  js/ui.js                dialogs, toasts, popover menus
  js/views/               auth, sidebar, chat, handoff-dialog, settings
  js/app.js               bootstrap, render subscriptions, shortcuts, test surface
tools/serve.js            static server
backend/                  Spring Boot REST foundation (see README section above)
tests/                    smoke tests, console diagnostic, generated screenshots
```

State flows one way: a view calls an action → the action updates the store → the store notifies →
the view re-renders. `window.__ytalks` exposes the store, actions and selectors for the tests.

## Not in this milestone

No MySQL schema, no real authentication or API keys, no real streaming API, no cross-AI
backend logic. The mock AI's replies, latency and failures are simulated in
`frontend/js/mock-ai.js`; the real integration points arrive with the backend milestone.
The backend (`backend/`) is deliberately thin: one health endpoint, CORS configuration,
a JSON error envelope and structured logging — the layers later milestones build on.
