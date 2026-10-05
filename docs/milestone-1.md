# Milestone 1 — verification report

Frontend prototype for Ytalks: all conversation and cross-AI handoff flows working against mock
data, verified end to end in a real browser.

## Result

```
Milestone 1 UI smoke test — 94/94 checks passed
```

Command: `npm test` (starts `tools/serve.js` on port 4319, drives Chrome through 20 steps, writes
18 screenshots to `tests/screenshots/`, exits non-zero on any failure).

## What was verified, step by step

| Step | What it proves |
| ---- | -------------- |
| Auth screen | Login form visible, register form hidden and switchable |
| Form validation | Empty submit and bad email/short password both produce correct inline errors |
| Registration screen | Register form renders, password strength meter reacts (4/4 bars) |
| Sign in | Demo account signs in, shell renders, user chip shows the account, 5 seeded conversations, day grouping (Today / Yesterday / Previous 7 days), active thread opens with 8 messages, AI bubbles labelled with their provider and model |
| Send a message | Send enables on input, user bubble appears immediately, loading indicator while "thinking", streamed reply attributed to the provider with model and latency, reply is topic-aware, composer clears |
| Provider selector | Menu lists all 4 providers, active one marked `aria-checked`, exposes its 3 models |
| Cross-AI handoff (YES) | Dialog asks to continue, offers exactly Cancel / Start new chat / Continue conversation, previews the context to be transferred, records the handoff divider, conversation continues on the new provider, **original 10 messages preserved in the same thread** |
| Continued conversation | The new provider acknowledges the transferred context and names the message count; the header shows the handoff count |
| Cross-AI handoff (NO) | A brand-new empty conversation opens on the new provider; the previous conversation still has all 13 messages; empty state shown |
| New chat & history | Starter prompt sends, New chat creates an empty conversation and adds it to the list, search filters by title **and** message text, clearing restores the full list |
| Persistence | Session, 7 conversations and 2 handoffs survive a full page reload |
| Error handling | Rate-limit failure renders a friendly message with no technical leakage, offers retry, retry recovers and produces a reply |
| Settings & theme | 3 control groups + 4 stats, light theme applies to the document and repaints the chat area |
| Stop generating | Send becomes Stop while a request is in flight, and stopping removes the streaming bubble |
| Conversation management | Rename updates sidebar and header; duplicate produces an independent copy |
| Responsive layout | Desktop shows a 288px sidebar column; tablet collapses it behind the menu button and opens it as a scrim drawer; mobile has no horizontal overflow; Escape closes the drawer |
| Branding & ambient background | Title, DOM text and served HTML all say Ytalks; the ambient layer is present, fixed, non-interactive and `aria-hidden`; glass panels carry the expected computed styles; reduced-motion disables the drift; a rendered-pixel audit confirms the background stays dark (max luminance < 0.012 after outlier rejection), cool-toned, and darker behind the reading column than at the edges |
| Accessibility basics | Every visible control has an accessible name, the message log is an `aria-live` region, dialogs trap focus and restore it on close |
| Sign out | Returns to the auth screen and hides the shell |
| Visual & layout audit | See below |
| Console hygiene | No uncaught page errors, no console errors |

## Visual & layout audit

The design was verified objectively rather than by eye, by measuring computed styles in the browser.

- **WCAG AA contrast**, worst-case measured per element in **both** themes, including every colour
  stop of a gradient background:
  - AI reply text 15:1 (dark) / 17.84:1 (light)
  - Secondary header text 5.38:1 (dark) / 4.65:1 (light)
  - Sidebar row titles 8.38:1 (dark) / 7.35:1 (light)
  - User bubble label on its gradient 5.05:1
  - Primary button label on its gradient 5.24:1
- **Typography scale**: body 15px, message text 15px, sidebar title 13px, system UI font stack.
- **Layout**: message column is 780px, centred with an equal 186px inset on each side inside the
  chat area; no bubble overflows the column; a 2540px thread scrolls inside a 703px message area.
- **Scrolling**: opening a conversation lands on the newest message.
- **Composer** is anchored to the bottom of the viewport.
- **Focus**: a visible focus ring is rendered (2px solid outline).
- **Provider accents** are four distinct colours.
- **`prefers-reduced-motion`** has a dedicated CSS block.
- **Cinematic background** (`frontend/css/ambient.css`): a fixed, pointer-events-none
  layer with four radial glows, a masked hairline grid, grain and a vignette, drifting
  on a 64s loop. Verified in rendered pixels: the brightest background sample stays
  below 0.012 luminance, the light sources read cool/violet, and the reading column
  (~0.005) is deliberately darker than the page edges (~0.008) thanks to a radial
  scrim on `.messages`. Dark and light themes each tokenise the glows; the drift stops
  under `prefers-reduced-motion`.

Three real contrast defects were found by this audit and fixed in `frontend/css/tokens.css`:

1. White text on the cyan end of the primary-button gradient measured ~1.9:1. The brand gradient is
   now violet → indigo (`#6f4df0 → #4f52ea → #3a63dd`), every stop ≥ 5:1 on white. Cyan is retained
   only for decorative elements (logo, orb, handoff line), which carry no text.
2. White text on the user-bubble gradient measured 3.78:1 at its light end. It is now
   `#6a45f0 → #3f63e8` (worst stop 5.05:1).
3. Muted/tertiary text measured 4.43:1 (dark) and 3.49:1 (light). The token is now `#7d8598` (dark,
   5.38:1) and `#667084` (light, 4.65:1).

## Screenshots

`tests/screenshots/` (regenerated by every test run) covers: login, register with strength meter,
empty state, chat with a long thread, provider menu open, cross-AI handoff dialog, the YES result
with the handoff divider, the NO result, history search, error state with retry, settings in both
themes, the stop-generating state, the mobile drawer, and the signed-out screen.

## Known limitations (intentional for Milestone 1)

- All data is in `localStorage`; there is no server, no database and no cross-device sync.
- Authentication is mocked client-side and is not secure. It exists to show the flow.
- Replies, latency and failures come from `frontend/js/mock-ai.js`; the wording is generic and
  topic-keyed, not a real model response.
- "Clear messages" and "Delete conversation" affect the local copy only.

## Environment used for verification

Node v24.17.0, npm 11.13.0, Google Chrome (stable) on Windows 11, tested at 1440×900, 1024×768 and
390×844 viewports. Java 26 is present; Maven 3.9.16 (wrapper) is used from Milestone 2 onward.
