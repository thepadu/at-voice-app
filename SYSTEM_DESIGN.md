# Chumz Call Center — System Design

This describes the system as it exists today, not a history of how it got here. See git history / commit messages for that.

## Architecture

```
Africa's Talking ──► app.js (Express)  ──► Supabase (call_logs, agents, ivr_options,
   (voice webhooks)         │                        ivr_config, tickets, ticket_tags,
                             ├── api.js      JSON API   forwarding_config, forwarding_rules)
                             ├── auth.js     Google SSO + role resolution
                             ├── outbound.js manual outbound dialing (/call)
                             ├── lib/voice.js shared Africa's Talking calling helper
                             └── /web/dist   React SPA, served as static files at /app
```

One Express process serves everything. The React app is built (`vite build` in `/web`) into static files served at `/app`; there is no separate hosting or CORS configuration since it's all one origin. `/` is a plain-text health check for Render — deliberately not the SPA's route, since Render's health check may depend on that exact response.

Schema changes live in `at-voice-app/migrations/*.sql`, numbered and applied in order — every one is idempotent (safe to re-run), which matters since there's no migration-runner tooling, just the Supabase SQL editor.

**Historical data note**: `call_logs.session_id` had no unique constraint on the live table until `005a_dedupe_call_logs.sql` was run (2026-08). Before that, every `.upsert(..., { onConflict: 'session_id' })` call in `app.js` silently fell back to a plain `INSERT` — there was no constraint for Postgres to conflict against — so each real call left 2-3 rows in `call_logs` (one per lifecycle stage: `/ivr`, `/handle-input`, `/events`) instead of one row updated in place. `005a` merges those into one row per session before the constraint is added. Any call-count stats reported before that migration ran were inflated roughly 2-3x.

## Auth & roles

Google OAuth (`auth.js`), open to **any** Google account — no domain or email allowlist (a deliberate tradeoff, see the file's own comment). What an authenticated user can *do* depends on whether their email matches an `agents` row and what `role` it has.

- Session: a JWT in an `httpOnly` cookie, containing `{ email, name, role, agentId }`, resolved from `agents` at login time. An unrecognized email defaults to `role: 'agent'`. These don't update until the next login — promoting someone to supervisor needs them to log out/in or wait out the 7-day token expiry.
- `requireAuth`: valid session required. Used on everything except the Africa's Talking webhooks (`/voice`, `/ivr`, `/handle-input`, `/events`, `/agent-standby`, `/agent-standby-input`), which must stay open for AT's servers to reach.
- `requireSupervisor`: `requireAuth` plus `role === 'supervisor'`. Gates the entire agent roster and IVR/forwarding configuration API — reads included, not just writes. Two routes under `/api/agents/*` are intentionally *not* supervisor-gated: `/api/agents/stats` (any agent needs their own numbers for the Dashboard) and `/api/agents/me/status` (self-service presence toggle).
- `/api/tickets*` and `/api/queue`, `/api/calls*` are `requireAuth` only — day-to-day agent work, not roster/config management.

## Data model

- **`call_logs`**: one row per call (or call leg), keyed by Africa's Talking's `session_id`. `status` values: `ivr_started`, `input_received`, `queued` (waiting in the hold queue), `ongoing`, `completed`, `failed`, `unknown`.
- **`agents`**: `id, name, phone, email, status ('available' | 'on_call' | 'ringing' | 'break' | 'offline'), role ('agent' | 'supervisor')`. See Call routing below for how `status` actually changes.
- **`ivr_options`**: one row per menu digit (`digit, label, response_message, action`). `action` is `message`, `transfer_agent` (puts the caller in the hold queue), or `repeat_menu`.
- **`ivr_config`**: single row holding the greeting line spoken before the per-digit menu.
- **`tickets`**: a real entity (`session_id, caller_name, caller_number, tag, priority, status, assigned_agent_id, notes, created_at`) — the Tags & Tickets page. `call_logs.ticket_status` (an older, simpler enum) still exists in the schema but nothing in the current UI writes to it anymore; `tickets` is the real thing now.
- **`ticket_tags`**: supervisor-editable list of tag names (seeded with the design reference's tags: Billing, Technical, Sales, Complaint, General, Retention).
- **`forwarding_config`** / **`forwarding_rules`**: enable flag + condition→destination rules. **Not wired into actual call routing** — see Call routing below for why.

## Call routing

Inbound: `/voice` → `/ivr` (builds the menu from `ivr_config` + `ivr_options`, live) → `/handle-input` (branches on the pressed digit's `action`).

**`transfer_agent` uses a real hold queue, not a direct dial.** The caller is put on hold with `<Enqueue name="support-queue"/>` and their `call_logs` row is marked `queued`. Getting them to an agent depends entirely on an agent being on standby:

1. An agent goes `available` (Agents page toggle) → this **places a real outbound call** to their phone (`api.js`'s `setAgentStatus`, via `lib/voice.js`). Sets `status: 'ringing'` immediately; if the call fails to place, reverts to `offline` and surfaces an error rather than showing them as available with nothing actually happening.
2. Africa's Talking has no per-call callback override — every outbound call, once answered, hits the single account-wide `/voice` URL. A `clientRequestId` of `agent-standby:{id}` (the only documented way to tag an outbound call) is how `/voice` tells this apart from a plain inbound call, and redirects to `/agent-standby?agentId={id}`.
3. `/agent-standby` sets `status: 'available'` and loops: `<Say>...</Say><GetDigits ... callbackUrl=".../agent-standby-input">` with a trailing `<Redirect>` back to itself on timeout — the exact same "no input" fallback pattern `/ivr` already uses.
4. Pressing any digit hits `/agent-standby-input`: if a `call_logs` row is `queued`, sets the agent to `on_call` and responds `<Dequeue name="support-queue"/>` followed by a `<Redirect>` back into the standby loop (so the agent returns to standby once that call ends, rather than the whole line hanging up). If nothing's queued, says so and loops back.
5. `/events` (Africa's Talking's call-state webhook) still tags `agent_number` on the customer's `call_logs` row for stats, and — now more narrowly than before — sets the agent back to `offline` when their overall standby call ends entirely (`completed`/`failed`). It no longer owns the `available`/`on_call` transitions; steps 3–4 do, since they know precisely what's happening and `/events` can't distinguish "idling in the standby loop" from "bridged to a customer" (both look like one continuous `ongoing` call leg from Africa's Talking's side).

**Why a hold queue instead of ringing agents directly (the previous approach)**: a real clickable "Answer" button in a browser would need agents taking calls via a WebRTC softphone — the only Africa's Talking browser-calling SDK found (`africastalking-client`) is deprecated, unmaintained since December 2020. Rather than build on a dead dependency, this rests on Africa's Talking's actual current, documented capability instead.

**Confirmed** (from Africa's Talking's SDK READMEs): `<Enqueue>`/`<Dequeue>` exist and work as described above; `<Dequeue>` only runs as the response to a webhook fired by an already-live call — there's no REST endpoint to inject new instructions into a live call from our server.

**Unverified — needs a real test call before trusting**:
1. Whether `Dequeue` is strictly FIFO or can target a specific caller (assumed FIFO — the Live Queue page's rows are informational, not individually clickable).
2. Exact behavior when the queue is empty at Dequeue time.
3. Whether an agent's standby call can sit in a `GetDigits` loop indefinitely without Africa's Talking timing it out server-side.
4. The `destinationNumber`/`direction` field assumptions in `/events` (flagged since the very first version of this tagging logic).

**Call Forwarding is data-entry only, not yet live.** Africa's Talking's `<Enqueue>` has no documented timeout/max-wait parameter, and there's no API to reach into an already-queued call and redirect it — so there's no confirmed mechanism to trigger a "no answer" rule automatically. Building that trigger would mean guessing at undocumented behavior. The rules/toggle are real and saved; they just don't do anything to a live call yet.

## Phone number handling

Shared in `at-voice-app/lib/phone.js`: general E.164 validation rather than Kenya-only, used by `outbound.js` and `api.js`. A bare local-format number (`0712345678`) still assumes Kenya (+254) when normalized — flagged for whenever a second market is added.

## React app (`/web`)

Vite + React + TypeScript + React Router + TanStack Query. ESLint + Prettier + Vitest/RTL are set up and passing.

**Layout**: sidebar (`components/layout/Sidebar.tsx`, 7 items, role-aware — Agents/IVR/Forwarding only render for supervisors) + topbar + a real active-call status bar (`components/widgets/StatusBar.tsx`, shown whenever the logged-in agent's own status is `on_call`).

**Pages** (`pages/*`, code-split via `React.lazy`):
- `/` Dashboard — KPI cards, calls-by-hour chart, live-calls panel, supervisor leaderboard or an individual agent's own performance.
- `/queue` (Live Queue) — who's actually on hold, with SLA row coloring. No clickable "Answer" — a note explains why (see Call routing above).
- `/outbound` (Outbound & Missed) — missed calls with "Call back," and the outbound log.
- `/tickets` (Tags & Tickets) — recent calls, the tickets table, and a creation panel.
- `/agents` (supervisors only) — roster card grid (4 statuses now: available/on_call/ringing/break/offline — the toggle only manually reaches available/break/offline) + performance table.
- `/ivr` (supervisors only) — editable greeting + per-digit menu with a live call-flow preview.
- `/forwarding` (supervisors only) — enable toggle + rules, with an explicit note that it's not live yet.

**Real-time-ish widgets**, mounted globally via `Layout`: the active-call `StatusBar`, a `WrapUpModal` that appears when polling detects the agent's own status transition from `on_call` back to `available` (prompts a disposition, logs it as a ticket), a `QuickTicketModal` reachable from the status bar's "+Ticket" button or the `T` keyboard shortcut, and the pre-existing floating dialer / live-analytics popover. `E` opens wrap-up early. There's deliberately no `A` (answer) shortcut — accepting a call is a phone action in this architecture, not a browser one.

**Cross-cutting** (`lib/*`): `api.ts`, `auth.tsx`, `theme.tsx` (dark mode, shell/topbar only), `toast.tsx`, `activeCall.tsx` (polls `/api/agents/me/active-call` every 5s, tracks the on_call→available transition to trigger wrap-up), `useKeyboardShortcuts.ts`, `useModalA11y.ts` (shared focus-trap + Escape for every modal).

## Scalability notes

- Agent-phone caching (`lib/agentCache.js`, 30s TTL) still removes a full-table query from the hottest webhook path (`/events`).
- **Known limitation**: no pagination on `/api/calls`/`/api/tickets` (`.limit(200)`). Fine today; will need cursor-based pagination once history grows.
- **Known limitation**: no push layer — everything real-time-feeling here is a 5–10s poll (`refetchInterval`). A real push layer (Express subscribing to Supabase Realtime server-side, relaying to browsers over SSE) is a bigger, separate change.
- **Known limitation**: no rate limiting on `/call` or on triggering an agent's standby call — both place real, billed Africa's Talking calls.
- **New cost consideration**: going "available" now places a real outbound call every time, not a free flag flip. Worth keeping an eye on Africa's Talking billing if agents toggle status often.

## What's deliberately not built

1. **Real-time push** — see Scalability notes.
2. **Live call-forwarding routing** — data layer exists, not wired in (see Call routing above).
3. **Multi-country (Rwanda)**: one Africa's Talking account covers every market they operate in — just needs a second Voice-enabled number. Not yet built: a `country` column on `agents`/`ivr_options`, and a way to resolve which country an inbound call belongs to.
4. **A browser softphone**: deliberately not pursued — see Call routing above for why (dead dependency). Revisit if Africa's Talking ships something newer, or if a live test proves the hold-queue approach doesn't hold up in practice.

## Verification

This environment can now actually run Node (a sandbox restriction, not a genuine absence — see chat history), so this has been executed, not just reviewed:
1. `npm install` in both `at-voice-app/` and `web/` — clean, no version conflicts.
2. `tsc -b && vite build` in `web/` — zero type errors. `npm run lint` — zero errors (a few benign "fast refresh" warnings on context files). `npm test` — 13/13 passing.
3. Booted the real backend and curled every new and pre-existing route: health check, the new login hero, `/app`'s SPA fallback, `/voice`'s branching (plain inbound vs. `agent-standby:` clientRequestId), `/agent-standby` and `/agent-standby-input`'s XML with a deliberately-unreachable Supabase URL (confirmed graceful fallback, no crash), `/handle-input`'s queue path, `/events`, and auth gating (401s) on `/api/me`, `/api/tickets`, `/api/agents`.
4. **Not verified, and can't be from this environment**: an actual phone ringing, a real agent pressing 1, a real Dequeue bridging a real caller. Run `migrations/005_queue_tickets_forwarding.sql`, then place one real test call end-to-end — that's the real verdict on the "Unverified" items in Call routing above.
