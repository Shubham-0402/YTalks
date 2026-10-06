# Ytalks

A multi-AI chat workspace: hold one conversation and move it between OpenAI, Google Gemini,
Anthropic Claude and DeepSeek without losing the thread.

**Status: Milestone 3 complete.** The frontend prototype (Milestone 1) runs on mock data,
plus a Spring Boot REST foundation with MySQL/JPA persistence (Milestone 3). The backend
provides REST endpoints for conversations, messages, and AI providers. No authentication
or real provider calls exist yet.

## Run it

```bash
npm install     # one dev dependency: puppeteer-core (tests only)
npm start       # http://localhost:4173/
```

`npm start` runs a zero-dependency static file server (`tools/serve.js`). Pass a port to override it:
`node tools/serve.js 8080`.

### Backend (Milestone 3)

**Prerequisites:**
- MySQL 8.0+ running on localhost:3306 (or configure via environment variables)
- Database `ytalks` will be created automatically
- Root user with password `change_me` (change in production!)

```bash
cd backend
./mvnw package          # builds target/ytalks-backend-0.3.0.jar (17 tests)
./mvnw spring-boot:run  # http://localhost:8080/api/health
```

`mvnw`/`mvnw.cmd` are the Maven Wrapper — no Maven installation is required (Java 17+ is).
Configuration lives in `backend/src/main/resources/application.yml`; every setting has a
default and can be overridden with an environment variable (`YTALKS_PORT`,
`YTALKS_CORS_ALLOWED_ORIGINS`, `YTALKS_DB_HOST`, `YTALKS_DB_PASSWORD`, …) — see `backend/.env.example`.

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

## Milestone 3 — MySQL Database + JPA Persistence

### Database schema

The following tables are created automatically by Hibernate (`ddl-auto: update`):

- **users** — application users (prepared for Milestone 4 authentication)
  - `id` (BIGINT, PK), `name` (VARCHAR), `email` (VARCHAR, UNIQUE), `phone` (VARCHAR),
  - `password_hash` (VARCHAR, not used yet), `created_at`, `updated_at`

- **ai_providers** — known AI providers (seeded at startup)
  - `id` (BIGINT, PK), `provider_name` (VARCHAR, UNIQUE), `provider_type` (VARCHAR),
  - `enabled` (BOOLEAN), `created_at`, `updated_at`
  - Seeded records: OpenAI, Google Gemini, Anthropic Claude, DeepSeek

- **conversations** — user conversations
  - `id` (BIGINT, PK), `user_id` (FK → users), `title` (VARCHAR),
  - `provider_id` (VARCHAR), `model` (VARCHAR), `created_at`, `updated_at`

- **messages** — messages within conversations
  - `id` (BIGINT, PK), `conversation_id` (FK → conversations), `sender_type` (ENUM: USER, ASSISTANT, SYSTEM),
  - `content` (TEXT), `provider_id` (VARCHAR), `model` (VARCHAR), `created_at`

- **conversation_providers** — join table tracking which providers participated in a conversation
  - `id` (BIGINT, PK), `conversation_id` (FK), `provider_id` (FK → ai_providers),
  - `first_used_at`, `message_count`
  - Unique constraint on (conversation_id, provider_id)

### New REST endpoints (for persistence verification)

All endpoints require `X-User-Id` header (temporary dev mechanism; replaced by auth in Milestone 4).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/providers` | List enabled AI providers |
| GET | `/api/conversations` | List conversations (paginated) |
| POST | `/api/conversations` | Create conversation |
| GET | `/api/conversations/{id}` | Get conversation with messages |
| PATCH | `/api/conversations/{id}` | Update title/provider/model |
| DELETE | `/api/conversations/{id}` | Delete conversation |
| POST | `/api/conversations/{id}/clear` | Clear messages, keep conversation |
| GET | `/api/conversations/{id}/messages` | List messages (paginated) |
| POST | `/api/conversations/{id}/messages` | Add message (USER, ASSISTANT, or SYSTEM) |

### Database configuration

Configure via environment variables (see `backend/.env.example`):

```
YTALKS_DB_HOST=localhost
YTALKS_DB_PORT=3306
YTALKS_DB_NAME=ytalks
YTALKS_DB_USERNAME=root
YTALKS_DB_PASSWORD=change_me
```

### MySQL setup (Windows)

```powershell
# Install via winget
winget install -e --id Oracle.MySQL --accept-source-agreements --accept-package-agreements

# Initialize data directory (run as Administrator or use custom datadir)
mkdir C:\mysql-data
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --initialize-insecure --datadir=C:\mysql-data

# Start server
Start-Process "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" -ArgumentList "--datadir=C:\mysql-data", "--console"

# Set root password
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -u root -e "ALTER USER 'root'@'localhost' IDENTIFIED BY 'change_me'; FLUSH PRIVILEGES;"

# Create database (done automatically by app, but can be done manually)
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -u root -pchange_me -e "CREATE DATABASE IF NOT EXISTS ytalks;"
```

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
backend/
  src/main/java/com/ytalks/backend/
    config/               CORS, request context, data initializer
    controller/           Health, Conversation, AiProvider endpoints
    dto/                  JSON request/response records
    entity/               JPA entities (User, Conversation, Message, AiProvider, ConversationProvider)
    exception/            Global error handling, API exceptions
    repository/           Spring Data JPA repositories
    service/              Business logic (User, Conversation, AiProvider services)
tests/                    smoke tests, console diagnostic, generated screenshots
```

State flows one way: a view calls an action → the action updates the store → the store notifies →
the view re-renders. `window.__ytalks` exposes the store, actions and selectors for the tests.

## Not in this milestone (yet)

- ❌ Real authentication (login, registration, OTP, JWT) — Milestone 4
- ❌ Real AI provider integration (OpenAI, Gemini, Claude, DeepSeek APIs) — Milestone 6
- ❌ API keys/secrets management — later milestone
- ❌ Cross-AI context transfer backend logic — later milestone
- ❌ Image generation, payments, production deployment

The mock AI's replies, latency and failures are simulated in
`frontend/js/mock-ai.js`; the real integration points arrive with later milestones.
