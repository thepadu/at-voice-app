# Chumz Support — Web App

The React admin console, talking to the JSON API in `../at-voice-app/api.js`. See `../SYSTEM_DESIGN.md` for the full architecture and reasoning.

## ⚠️ Before you run anything

This was hand-written without access to Node/npm in the environment it was built in, so nothing here has actually been installed, built, or run yet. The versions in `package.json` are reasonable-but-unverified starting points — `npm install` may need to adjust a few. Treat the first `npm install` as the real test of whether this scaffold is sound.

## Setup

```bash
cd web
npm install
```

If `npm install` complains about peer dependency mismatches, that's the version-pinning risk above — bump whatever it flags.

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
npm run lint     # ESLint
npm run format   # Prettier, writes in place
npm test         # Vitest
```

None of these have been run yet either (see the warning above) — the first run of each is itself a real test of whether the configs are sound, not just a formality.

## Production build

```bash
npm run build
```

Outputs to `web/dist`, which `at-voice-app/app.js` serves at `/app` (e.g. `https://at-voice-app.onrender.com/app`). On Render, the build command needs to install and build **both** `at-voice-app/` and `web/` — check how it's currently configured; a single-project setup will likely only build the backend.

## What's here

Dashboard (KPIs, live calls, supervisor leaderboard / agent's own performance), Calls (tabbed list + ticket status), a floating quick-dial widget and live-analytics popover (present on every page), Agents (supervisors only — roster management, presence toggle, roles), IVR editor (supervisors only — greeting + menu options with a live call-flow preview). Role-gated via `useAuth().isSupervisor` on the frontend and `requireSupervisor` on the backend (frontend gating is just UX — the real boundary is server-side).

Not built: a client-side login page (real Google OAuth requires a full-page redirect anyway, so unauthenticated users are sent to the existing `/login` HTML page), and the larger deferred items in `SYSTEM_DESIGN.md` (a real Tickets entity, call forwarding rules, a real live-queue "Answer", multi-country support).
