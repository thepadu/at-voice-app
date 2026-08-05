# Chumz Support — Web App

The React admin console, talking to the JSON API in `../at-voice-app/api.js`. See `../SYSTEM_DESIGN.md` for the full architecture and reasoning.

## Setup

```bash
cd web
npm install
```

This has been run and verified in the environment this was built in — `npm install` resolves clean, `npm run build`/`lint`/`test` all pass. Still worth re-running yourself as a sanity check.

## Development

Run the backend and frontend as two processes:

```bash
# Terminal 1 — from at-voice-app/
npm start

# Terminal 2 — from web/
npm run dev
```

Vite's dev server proxies `/api`, `/call`, `/login`, `/auth`, `/logout` to `http://localhost:3000` (see `vite.config.ts`), so you get instant reload on the React side while auth and data still come from the real Express server.

Sign in by visiting `http://localhost:3000/login` first (this sets the session cookie), then open the Vite dev URL — the cookie is shared since both are `localhost`.

## Quality checks

```bash
npm run lint     # ESLint — passes clean
npm run format   # Prettier, writes in place
npm test         # Vitest — 13/13 passing
```

## Production build

```bash
npm run build
```

Outputs to `web/dist`, which `at-voice-app/app.js` serves at `/app` (e.g. `https://at-voice-app.onrender.com/app`). On Render, the build command needs to install and build **both** `at-voice-app/` and `web/` — check how it's currently configured; a single-project setup will likely only build the backend.

## What's here

Full sidebar IA: Dashboard (KPIs, calls-by-hour chart, live calls, leaderboard/own performance), Live Queue (who's on hold, SLA-colored wait times), Outbound & Missed (call back / outbound log), Tags & Tickets (real ticket entity — tags, priority, assignee, notes), Agents (supervisors only — 4-state presence, roster CRUD), IVR Builder (supervisors only — greeting + menu + live preview), Call Forwarding (supervisors only — rules saved but not yet wired into live routing, see `SYSTEM_DESIGN.md`). A real active-call status bar, a wrap-up prompt, `T`/`E` keyboard shortcuts, floating dialer + live-analytics popover on every page. Role-gated via `useAuth().isSupervisor` on the frontend and `requireSupervisor` on the backend (the real boundary is server-side).

Not built: a client-side login page (real Google OAuth requires a full-page redirect anyway, so unauthenticated users are sent to the existing `/login` HTML hero page), live call-forwarding routing, a browser softphone (deliberately not pursued — see `SYSTEM_DESIGN.md`), multi-country support.
