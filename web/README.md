# Chumz Support — Web App

React replacement for the server-rendered HTML dashboard (`dashboard.js`), talking to the JSON API in `../at-voice-app/api.js`. See `../SYSTEM_DESIGN.md` for the full architecture and reasoning.

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

## Production build

```bash
npm run build
```

Outputs to `web/dist`, which `at-voice-app/app.js` serves at `/app` (e.g. `https://at-voice-app.onrender.com/app`). On Render, you'll want a build step that runs both `npm install && npm start` in `at-voice-app/` **and** `npm install && npm run build` in `web/` before the server starts — check how Render's build command is currently configured and extend it, since right now it likely only builds the backend.

## What's here vs. not

Built: Dashboard (summary + live calls), Calls (tabbed list + ticket status), Dialer, Agents (performance stats). Not built: a client-side login page (real Google OAuth requires a full-page redirect anyway, so unauthenticated users are sent straight to the existing `/login` HTML page rather than a React equivalent), any of the deferred roadmap items in `SYSTEM_DESIGN.md` (agent/IVR management, analytics charts, archiving, call transfer).
