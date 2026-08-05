# Chumz Call Center — System Design

This describes the system as it exists today, not a history of how it got here. See git history / commit messages for that.

## Architecture

```
Africa's Talking ──► app.js (Express)  ──► Supabase (call_logs, agents, ivr_options, ivr_config)
   (voice webhooks)         │
                             ├── api.js      JSON API for the React app
                             ├── auth.js     Google SSO + role resolution
                             ├── outbound.js manual outbound dialing (/call)
                             └── /web/dist   React SPA, served as static files at /app
```

One Express process serves everything. The React app is built (`vite build` in `/web`) into static files served at `/app`; there is no separate hosting or CORS configuration since it's all one origin. `/` is a plain-text health check for Render — it is deliberately not the SPA's route, since Render's health check may depend on that exact response.

`call_logs`, `agents`, `ivr_options`, and `ivr_config` (Supabase/Postgres) are the entire data model. No other database or external state store is involved. Schema changes live in `at-voice-app/migrations/*.sql`, numbered and applied in order — every one is idempotent (safe to re-run), which matters since there's no migration-runner tooling, just the Supabase SQL editor.

## Auth & roles

Google OAuth (`auth.js`), open to **any** Google account — there is no domain or email allowlist. This is a deliberate tradeoff (see the file's own comment for the reasoning) traded off against role-based access: what an authenticated user can *do* depends on whether their email matches an `agents` row and what `role` it has.

- Session: a JWT in an `httpOnly` cookie, containing `{ email, name, role, agentId }`. `role` and `agentId` are resolved from `agents` at login time (an unrecognized email defaults to `role: 'agent'`, the more restricted tier) — they do **not** update until the next login, so promoting someone to supervisor needs them to log out/in or wait out the 7-day token expiry.
- `requireAuth` (in `auth.js`): valid session required. Used on everything except the Africa's Talking webhooks (`/voice`, `/ivr`, `/handle-input`, `/events`), which must stay open for AT's servers to reach.
- `requireSupervisor`: `requireAuth` plus `role === 'supervisor'`. Gates the entire agent roster and IVR configuration API (`/api/agents`, `/api/agents/:id`, `/api/ivr-options*`, `/api/ivr-config`) — reads included, not just writes, so there's one boundary to reason about rather than a per-route judgment call. Two routes are intentionally **not** supervisor-gated despite living under `/api/agents/*`: `/api/agents/stats` (any agent needs their own numbers for the Dashboard) and `/api/agents/me/status` (self-service presence toggle) — both return/act on data scoped enough that a plain agent seeing them isn't a roster leak.

## Data model

- **`call_logs`**: one row per call (or call leg — see below), keyed by Africa's Talking's `session_id`. Written by the IVR webhooks and `/events`; read by the Calls/Dashboard pages.
- **`agents`**: `id, name, phone, email, status ('available' | 'on_call' | 'offline'), role ('agent' | 'supervisor')`. `status` is set two ways: manually (the presence toggle) and automatically (`/events` flips an agent to `on_call` when their leg goes `ongoing`, back to `available` when it ends — see Call routing below). `email` is optional; when set, it links a Google login to this row for self-service status and role resolution.
- **`ivr_options`**: one row per menu digit (`digit, label, response_message, action`). `action` is one of `message` (just says `response_message`), `transfer_agent` (dials available agents), `repeat_menu` (redirects back to `/ivr`).
- **`ivr_config`**: single row (`id = 1`) holding the greeting line spoken before the per-digit menu.

## Call routing

Inbound: `/voice` → `/ivr` (builds the menu from `ivr_config` + `ivr_options`, live) → `/handle-input` (branches on the pressed digit's `action`).

For `transfer_agent`: every currently-`available` agent is rung **simultaneously** — `<Dial phoneNumbers="+254...,+254...,..." sequential="false" .../>`, not one after another. With sequential dialing, N agents means up to N × 15s of pure ringing before a caller reaches anyone; ring-all fixes that with no schema change. First agent to pick up gets the call.

`/events` (Africa's Talking's call-state webhook) does three things per call-state change: updates `call_logs.status`, tags agent-leg events with `agent_number` for stats, and auto-flips that agent's `status` between `available`/`on_call` so a second overlapping call doesn't also ring someone already on a call. It looks up agent phone numbers through an in-memory cache (`lib/agentCache.js`, 30s TTL, invalidated on agent create/update/delete) rather than querying Supabase on every single webhook.

**Two unverified assumptions, flagged deliberately**: (1) the exact Africa's Talking payload field used to detect an agent leg (`destinationNumber`) — confirm against the `📡 EVENT` log on a live agent-transfer call; (2) `direction`-based incoming/outgoing classification in the API (`'Outbound'` → outgoing, else incoming) — IVR-originated rows don't get a `direction` until the first `/events` callback lands, so a call that's still ringing may briefly classify as neither cleanly.

## Phone number handling

Shared in `at-voice-app/lib/phone.js`: general E.164 validation (`+` followed by 8–15 digits) rather than Kenya-only, used by `outbound.js` and `api.js`. A bare local-format number (`0712345678`) is still assumed to be Kenya (+254) when normalized — that assumption will need a country hint once a second market is added (see Future work).

## React app (`/web`)

Vite + React + TypeScript + React Router + TanStack Query (`@tanstack/react-query` — `useQuery` for reads with built-in polling via `refetchInterval`, `useMutation` + query invalidation for writes, replacing hand-rolled `useEffect`/`useState` data-fetching).

**Layout**: a fixed sidebar (`components/layout/Sidebar.tsx`) + topbar (`Topbar.tsx`), composed in `Layout.tsx`. Sidebar nav is role-aware — Agents/IVR links only render for supervisors (`useAuth().isSupervisor`), and the routes themselves are wrapped in a `RequireSupervisor` guard in `App.tsx` as defense in depth beyond the hidden nav link (the real boundary is server-side, per Auth & roles above).

**Pages** (`pages/*`, code-split via `React.lazy`):
- `/` Dashboard — KPI cards, a live-calls panel, and either a supervisor leaderboard or an individual agent's own performance card (matched via the JWT's `agentId`).
- `/calls` — tabbed call list (All/Incoming/Outgoing/Missed) with inline ticket-status editing.
- `/agents` (supervisors only) — team roster as a card grid (presence toggle, add/edit/delete, role field) plus the performance table.
- `/ivr` (supervisors only) — editable greeting + per-digit menu options, with a live "call flow preview" rendering what a caller will actually hear.

**Widgets** (`components/widgets/*`), present on every page via `Layout`: a floating quick-dial FAB (posts to `/call`) and a floating "Live Analytics" popover (today's summary, fetched on demand).

**Cross-cutting** (`lib/*`): `api.ts` (fetch wrapper — `credentials: 'include'` so the session cookie rides along, redirects to `/login` on 401, parses `{error}` JSON bodies into a clean `ApiError`), `auth.tsx` (current user + role), `theme.tsx` (dark mode, persisted to `localStorage`, recolors the shell/topbar only — card surfaces stay light by design, not yet extended further), `toast.tsx` (transient notifications), `useModalA11y.ts` (shared focus-trap + Escape-to-close for every modal).

**Tooling**: ESLint (`eslint.config.js`, flat config) + Prettier for consistency; Vitest + React Testing Library for tests, currently covering the phone-format helpers and the API client's error-parsing logic — the cheap, high-value wins, not full coverage.

## Scalability notes

- **Ring-all dialing** (above) removes the main caller-facing bottleneck without any new infrastructure.
- **Agent-phone caching** removes a full-table query from the hottest webhook path (`/events`, called on every call-state change).
- **Known limitation**: the agent-phone cache is in-process. If this is ever scaled beyond one Render instance, each instance's cache can drift from the others for up to its TTL. Not a real concern at today's scale; a shared cache (Redis) is the fix if it ever becomes one.
- **Known limitation**: `/api/calls` has no pagination (`.limit(200)`). Fine today; will need cursor-based pagination once call history grows.
- **Known limitation**: no push layer — Dashboard/Calls poll every 10s via React Query's `refetchInterval`. Adequate for a handful of concurrent agents. A real push layer (Express subscribing to Supabase Realtime server-side, relaying to browsers over SSE — no client-side Supabase credentials or RLS changes needed) is a bigger, separate change.
- **Known limitation**: no rate limiting on `/call` (outbound dialing) beyond requiring login — a compromised session or frontend bug could run up real Africa's Talking charges.

## What's deliberately not built

1. **Tickets as a full entity** (tags, priority, assignee, notes) — today's `call_logs.ticket_status` is a single enum, not a separate ticket record.
2. **Call forwarding rules** — no such feature exists; needs decisions on what "destinations" and "after hours" mean.
3. **Real live-queue "Answer"** — Africa's Talking's `<Enqueue>`/`<Dequeue>` actions (confirmed to exist, see [AT Voice docs](https://developers.africastalking.com/docs/voice/actions/call_queue)) would let an agent claim a specific waiting caller onto their real phone, without a WebRTC/softphone project. Exact mechanics unverified against a live sandbox.
4. **Multi-country (Rwanda)**: confirmed one Africa's Talking account/credential set covers every market they operate in — Rwanda just needs a second Voice-enabled number under the same account. Not yet built: a `country` column on `agents`/`ivr_options`, and a way to resolve which country an inbound call belongs to (likely a destination-number field on the `/voice`/`/ivr` webhook — unverified which one). Phone validation is already general enough (see above) not to block this.
5. **Redis/shared caching, pagination, push updates, rate limiting** — see Scalability notes above.

## Verification

No Node available in the environment these changes were authored in, so nothing has been executed — only reviewed by hand.
1. Run every file in `migrations/` in order (all idempotent) against the Supabase project your Render env vars actually point to.
2. `npm install && npm start` in `at-voice-app/`; `npm install && npm run build` in `web/` (check `npm run lint` / `npm test` too — this is the first time those scripts exist, so treat a clean run as itself a thing to verify).
3. Confirm `/voice`, `/ivr`, `/handle-input`, `/events` still respond without auth.
4. Log in with an account not linked to any `agents` row — confirm Agents/IVR are hidden and return 403 if visited directly. Then set that email's `role` to `supervisor` directly in Supabase, log out/in, confirm access.
5. Place a real test call requesting an agent with 2+ agents marked `available` — confirm their phones ring simultaneously, and that the answering agent's row flips to `on_call` during the call and back after.
