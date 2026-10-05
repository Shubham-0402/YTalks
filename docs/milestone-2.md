# Milestone 2 — verification report

REST/JSON foundation: a Spring Boot backend with a health endpoint, plus a
non-disruptive connection badge in the Milestone 1 frontend.

## Results

```
Backend  (cd backend && ./mvnw test)   17/17 tests
M2 smoke (node tests/m2-smoke.mjs)      8/8 checks
M1 smoke (npm test)                    94/94 checks  — no regression
```

## Backend

Stack: Spring Boot 4.1.1, Java 17 baseline (built with JDK 26), Maven 3.9.16
via the checked-in wrapper (`backend/mvnw`). No database, no JPA, no Spring
Security, no AI SDKs — those arrive with the milestones that need them.

```
backend/
  pom.xml                     Spring Boot 4.1.1 parent, web + validation
  mvnw, mvnw.cmd, .mvn/       Maven Wrapper — no Maven install needed
  .env.example                every env var, with safe defaults
  src/main/java/com/ytalks/backend/
    YtalksBackendApplication.java
    config/                   WebConfig (CORS), CorsProperties,
                              ApiRequestContextFilter (X-Request-Id, MDC,
                              access log)
    controller/               HealthController
    service/                  HealthService (subsystem checks)
    dto/                      HealthResponse, HealthCheck, ApiErrorResponse
    exception/                ApiException, ResourceNotFoundException,
                              GlobalExceptionHandler (JSON envelope)
  src/main/resources/application.yml   port, CORS, logging — all env-overridable
```

Only packages that are useful today exist; `repository/`, `model/`,
`security/` and `provider/` arrive with the milestones that fill them.

### `GET /api/health`

```json
{
  "status": "UP",
  "service": "Ytalks backend",
  "version": "0.2.0",
  "environment": "default",
  "checks": [
    { "name": "api",         "status": "UP",             "detail": "REST endpoints are served" },
    { "name": "persistence", "status": "NOT_CONFIGURED", "detail": "no database is configured in this milestone" }
  ],
  "serverTime": "2026-10-05T15:47:27.737Z",
  "responseTimeMs": 0
}
```

### Error contract

Every failure returns the same JSON envelope and a `X-Request-Id` header
(echoing the client's id when it supplies one):

```json
{
  "timestamp": "…", "status": 404, "error": "Not Found",
  "code": "NOT_FOUND", "message": "No API endpoint matches /api/nope",
  "path": "/api/nope", "requestId": "b1cd83f8e39d443e",
  "fieldErrors": null
}
```

Handled: unmapped paths (404), wrong method (405 + `Allow`), malformed JSON
and type mismatches (400), bean-validation failures (400 with per-field
`fieldErrors`), known `ApiException`s (their own status/code), and anything
unanticipated (500 with the real cause in the server log only — never in the
response).

### Cross-origin access

`ytalks.cors.allowed-origins` lists exact origins (default: the dev server
on 4173 and the smoke-test server on 4319, both localhost and 127.0.0.1).
No wildcard, no credentials. A request from an unlisted origin is refused
with 403 rather than silently served — pinned by test.

### Configuration

Everything is environment-overridable without a rebuild
(`YTALKS_PORT`, `YTALKS_CORS_ALLOWED_ORIGINS`, `YTALKS_CORS_ALLOW_CREDENTIALS`,
`YTALKS_LOG_LEVEL`); see `backend/.env.example`. Logging uses the MDC request
id: `16:20:31.412 INFO  [b1cd83f8e39d443e] … GET /api/health -> 200 in 157 ms`.

## Frontend integration

`frontend/js/backend.js` — a minimal client that fetches `/api/health` with a
4s timeout and never throws. The chat header shows a badge
(`[data-testid="backend-status"]`) that reads **Backend: connected** when the
service answers UP and **Backend: offline** otherwise, re-checking every 30s.
The base URL can be overridden at runtime via
`localStorage["ytalks.backendBase"]` (used by the offline-resilience test).

Chat, auth and history remain on the Milestone 1 mock layer — the badge is the
only visible change, and the app works identically with the backend down.

## What was verified

| Check | Result |
| ----- | ------ |
| `GET /api/health` over HTTP | 200, `application/json`, `status: "UP"`, service "Ytalks backend" |
| Correlation id | present on every response; client-supplied id is echoed |
| Unknown path | 404 JSON envelope with code/path/requestId |
| CORS | configured origins echoed; unlisted origin refused 403; preflight OK |
| Configuration override | changing `ytalks.cors.allowed-origins` changes behaviour (test) |
| Bean validation | invalid body → 400 with per-field messages (test-only probe endpoint) |
| Browser badge | exists, flips to "connected" while backend is up |
| Offline resilience | badge degrades to "offline", zero page/console errors |
| Milestone 1 regression | 94/94 checks still pass with the badge in the header |

## Environment used for verification

Windows 11, Node v24.17.0, Google Chrome (stable) at 1440×900; JDK 26.0.2
running Maven 3.9.16 via `./mvnw`; Spring Boot 4.1.1 on Tomcat 11.0.24,
port 8080. Maven Central reachable; the wrapper downloads Maven itself on
first use.

## Next (Milestone 3)

MySQL schema and JPA persistence, real authentication, and the AI provider
proxy — all of which will reuse the error envelope, request-id logging and
CORS policy established here.
