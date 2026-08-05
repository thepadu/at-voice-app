# Chumz Call Center

A call-center system for Chumz customer support, built on Africa's Talking's Voice API. Handles inbound IVR routing, live agent dialing, call logging, and a React admin console for managing agents, the IVR menu, and call history.

## Layout

- **`at-voice-app/`** — the Express backend: Africa's Talking voice webhooks, Google SSO, and the JSON API the React app talks to. `npm start` runs it.
- **`web/`** — the React admin console (Vite + TypeScript), served by the Express app at `/app` once built. See [`web/README.md`](../web/README.md) for setup.
- **`at-voice-app/migrations/`** — SQL migrations for the Supabase database, numbered and applied in order via the Supabase SQL editor (no migration-runner tooling). All are safe to re-run.

## Where to start

- **[`SYSTEM_DESIGN.md`](../SYSTEM_DESIGN.md)** (repo root) — architecture, data model, call routing, auth/roles, and what's deliberately not built yet. Read this first.
- **[`web/README.md`](../web/README.md)** — frontend setup, dev workflow, and build/deploy notes.

## Running locally

```bash
cd at-voice-app
npm install
npm start
```

Requires `SUPABASE_URL`, `SUPABASE_KEY`, `AT_API_KEY`, `AT_USERNAME`, `AT_VOICE_NUMBER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, and `JWT_SECRET` as environment variables — see `SYSTEM_DESIGN.md`'s Auth section for what each does.
