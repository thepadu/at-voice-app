# Chumz Call Center — System Design

This describes the system as it exists today, not a history of how it got here. See git history / commit messages for that.

## Architecture

```
                    PSTN customer call
                            │
                 Africa's Talking SIP trunk
                            │
┌───────────────────────────────────────────────────────────┐
│  Self-hosted Asterisk 20 (VPS, sip.chumz.online)           │
│                                                             │
│  [from-at-trunk]  inbound customer calls                   │
│  [test-webrtc]    agent browsers dialing out                │
│         │                    ▲                              │
│         ▼                    │                              │
│    Stasis(chumz-ivr) ── ARI ─┘                              │
└─────────┬───────────────────────────────────────────────────┘
          │ ARI (Asterisk REST Interface, WebSocket + REST)
          ▼
   ari-app/index.js (Node, same VPS)
   IVR menu, hold queue, ring-all routing,
   inbound/outbound bridging, business hours,
   ghost-agent + stale-call reconciliation
          │
          ▼
      Supabase (Postgres) ◄──────────────┐
   call_logs, agents, agent_sip_credentials,   │
   ivr_options, ivr_config, tickets, ticket_tags,  │
   forwarding_config, forwarding_rules, business_hours
                                             │
                                             │
┌────────────────────────────────────────────┴──────────────┐
│  Express (Render): app.js                                  │
│    ├── api.js      JSON API for the React dashboard         │
│    ├── auth.js     Google SSO + role/agentId resolution     │
│    ├── lib/voice.js  Africa's Talking calling helper         │
│    │                 (legacy agent-standby fallback only)    │
│    └── /web/dist   React SPA, served as static files at /app │
└──────────────────────────────────────────────────────────────┘
          ▲
          │ WSS (SIP over WebSocket, DTLS-SRTP, ICE)
          │
   Agent's browser — SIP.js softphone, registered
   directly to Asterisk (lib/softphone.tsx)
```

Two separate Node processes, two separate hosts:
- **`ari-app/`** runs on the same Ubuntu 24.04 VPS as Asterisk itself (`sip.chumz.online`), started via systemd (`chumz-ari-app.service`, `Restart=always`). This is where all real-time call control lives — it talks to Asterisk over ARI (a WebSocket for events, REST for commands), and to Supabase for everything the dashboard needs to see.
- **`at-voice-app/`** (Express) runs on Render. It serves the React dashboard, the JSON API the dashboard calls, Google OAuth, and a small legacy fallback (see "Legacy Africa's Talking fallback" below). It does **not** handle any live call audio or signaling — that's entirely the ARI app's job.

Both processes talk to the **same Supabase project** with the `service_role` key (bypasses RLS at the Postgres role level — RLS policy content is a non-issue for either process).

Text-to-speech for the IVR (greeting, menu, messages) is self-hosted **Piper** (neural TTS), since Asterisk has no built-in TTS engine. Synthesized audio is cached as raw µ-law files keyed by a hash of the text, so a prompt is only actually re-synthesized when a supervisor edits it.

Schema changes live in `at-voice-app/migrations/*.sql` (currently 001–010), numbered and applied in order via the Supabase SQL editor — there's no migration-runner tooling, so every migration must be idempotent (safe to re-run), and applying them in order matters.

## Auth & roles

Google OAuth (`auth.js`), open to **any** Google account — no domain or email allowlist (a deliberate tradeoff). What an authenticated user can *do* depends on whether their (lowercased) email matches an `agents` row and what `role` it has.

- Session: a JWT in an `httpOnly`, `secure`, `sameSite: 'lax'` cookie, valid **7 days**, containing `{ email, name, role, agentId }` — `email` is lowercased and `agentId` resolved from `agents` once, at login. There is no server-side session revocation: demoting/removing an agent doesn't invalidate an already-issued token, it just expires naturally within 7 days.
- Every self-service endpoint (`/api/agents/me/*`) matches by the JWT's `agentId` when present, falling back to a case-insensitive email match only for sessions issued before this existed. Matching by raw email used to be case-sensitive against a case-sensitive unique column — a real mismatch (e.g. an email typed with different casing during manual provisioning) silently created a brand-new duplicate agent row instead of erroring, which is exactly the kind of bug `agentId`-based lookups sidestep.
- `requireAuth`: valid session required. Left open (no auth) for the routes Africa's Talking's servers call directly with no cookie to send: `/voice`, `/agent-standby`, `/agent-standby-input`, `/events`.
- `requireSupervisor`: `requireAuth` plus `role === 'supervisor'`. Gates the full agent roster, IVR/forwarding/business-hours configuration, and the Analytics page — reads included, not just writes. `/api/agents/stats` and `/api/agents/me/*` are intentionally *not* supervisor-gated (every agent needs their own numbers and presence control).

## Data model

- **`call_logs`**: one row per call, keyed by `session_id` (the originating Asterisk channel ID for calls handled by `ari-app`, or Africa's Talking's session id for the legacy fallback path). `status`: `ivr_started`, `input_received`, `queued`, `ongoing`, `completed`, `failed` (abandoned before an agent answered), `forwarded` (routed elsewhere because nobody was online), `after_hours`, `dialing` (outbound, ringing the destination). `direction`: `Inbound` / `Outbound`. `agent_number` is the bridged agent's phone number (matched against `agents.phone`, not `agents.id`, for historical reasons).
- **`agents`**: `id, name, phone, email, status ('available' | 'on_call' | 'ringing' | 'break' | 'offline'), role ('agent' | 'supervisor'), last_seen_at`. `last_seen_at` is a browser-softphone heartbeat timestamp (see "Presence integrity" below) — `status` alone was never trustworthy enough to route calls on.
- **`agent_sip_credentials`**: `agent_id, sip_username, sip_password` — links an agent to a PJSIP/WebRTC endpoint provisioned on the Asterisk box. An agent with a row here is on the real softphone; one without falls back to the legacy phone-standby flow.
- **`ivr_options`** / **`ivr_config`**: menu digits and the greeting line, supervisor-editable, read live by `ari-app` on every call (not cached beyond a call's own lifetime).
- **`business_hours`**: singleton row (`enabled, open_time, close_time, active_days, after_hours_message`). Checked by `ari-app` before running the IVR menu — outside these hours, the caller hears the message instead and the call is logged `after_hours`.
- **`tickets`** / **`ticket_tags`**: the Tags & Tickets page. `call_logs.ticket_status` (an older, simpler enum) still exists in the schema but nothing writes to it anymore.
- **`forwarding_config`** / **`forwarding_rules`**: enable flag + condition→destination rules. Only the **`no_answer`** condition is actually wired into live routing (see Call routing below) — `busy` and `always` are saved but not applied to anything yet.

## Call routing

### Inbound

1. A customer's call arrives via Africa's Talking's **SIP trunk**, straight into Asterisk's `[from-at-trunk]` PJSIP context, which drops it into `Stasis(chumz-ivr)` — `ari-app` takes control from there. This is a direct SIP handoff, not a webhook; Africa's Talking's REST voice-callback API is not involved in real inbound calls at all anymore.
2. `ari-app` answers the channel, logs `call_logs` (`status: 'ivr_started'`), and checks **business hours** — outside configured hours, it plays `after_hours_message` and hangs up (`status: 'after_hours'`), skipping the menu entirely.
3. **IVR menu**: plays the greeting + per-digit options (Piper TTS, played concurrently with listening for a barge-in DTMF digit so callers don't have to wait out the whole prompt). Loops on no input or an invalid digit.
4. `transfer_agent` action: if **zero** agents with a softphone are currently available, checks `forwarding_rules` for a `no_answer`-condition destination and forwards there if configured (`status: 'forwarded'`); otherwise the caller joins a real Asterisk **holding bridge** (`status: 'queued'`). One or two busy agents is normal and just means they queue — forwarding is only a fallback for *nobody* being logged in at all.
5. Every 3 seconds, the queue is polled: for each waiting caller, **every currently-available agent's browser rings simultaneously** (ARI originates a channel to each agent's PJSIP/WebRTC endpoint in parallel). First to actually answer wins — a synchronous claim check (before any `await`) guards against two agents answering in the same instant — the rest are hung up and reverted to `available`.
6. The winning leg is bridged with the customer in a new mixing bridge: `status: 'ongoing'`, agent `status: 'on_call'`. Either side hanging up destroys the bridge, hangs up both legs, reverts the agent to `available`, and marks the call `completed` with duration.
7. A caller who hangs up at *any* earlier stage (mid-menu, mid-queue, mid-ring, before anyone answers) is caught by a catch-all handler and marked `failed` — genuinely missed, not left in limbo.

### Outbound (agent-initiated)

1. An agent's browser (registered as a WebRTC softphone via SIP.js) sends a SIP INVITE for the destination number. Asterisk's `[test-webrtc]` context routes it into `Stasis(chumz-ivr, outbound-agent:{number})`.
2. `ari-app` answers the agent's own leg **immediately** (so their browser call goes "Established" right away, with a ring-indication tone played to them) and, concurrently — not blocking the dial — logs the initial `call_logs` row (`direction: 'Outbound'`, `status: 'dialing'`, agent identified by their PJSIP endpoint name) while originating a second channel to the destination via the trunk.
3. The destination channel can reach `'Up'` either immediately (a fast pickup) or after genuinely ringing for a while — both are handled, since a channel already `Up` the moment it's first seen will never fire an *additional* state-change event. Once `Up`, the two legs are bridged: `status: 'ongoing'`, agent `status: 'on_call'` (without this, an agent looked "available" for ring-all purposes for the entire duration of a call they were already on).
4. A destination that never answers (busy, rejected, times out) ends the call `failed`; a bridged call that completes normally ends `completed` with duration.

### Presence integrity ("ghost agents")

`agents.status` alone is never trusted blindly. The browser softphone sends a heartbeat (`PATCH /api/agents/me/heartbeat`) every ~20s while genuinely registered, stamping `last_seen_at`. The ARI app periodically (every 30s, plus once on startup) flips any agent claiming `available`/`ringing` with a stale (>90s) or missing heartbeat back to `offline` — catches a dead tab, a lost connection, or a row seeded/provisioned as `available` that nobody ever actually logged into. Scoped to agents with SIP credentials only; the legacy phone-standby flow doesn't run a heartbeat and doesn't need one.

Separately, on every startup the ARI app reconciles any `call_logs` row still sitting in a non-terminal status back to `failed` — its in-memory queue/ring-group state always starts empty after a restart, so anything still "in progress" from a previous process instance is orphaned by definition.

### Legacy Africa's Talking fallback (currently a dead end)

An agent with **no** row in `agent_sip_credentials` falls back, when going "available," to `api.js`'s `setAgentStatus` placing a real, billed phone call via `lib/voice.js`. When answered, Africa's Talking calls back into `/voice` (tagged `clientRequestId: agent-standby:{id}`), which redirects into `/agent-standby` → a `GetDigits` loop that, on a keypress, tries to `<Dequeue>` a caller from an Africa's Talking-side hold queue.

**This currently cannot work**: that queue is only ever populated by an `<Enqueue>` in the old `/handle-input` route, which was removed once real inbound calls stopped arriving via Africa's Talking's webhooks at all (see "Inbound" above — they go straight into Asterisk via the SIP trunk now). An agent without a softphone who goes "available" today will place a real call to their own phone and sit in a loop that always says "No calls waiting." Kept in place rather than deleted because removing it outright means deciding what should happen instead — a product decision, not a cleanup one.

## Frontend (`/web`)

Vite + React + TypeScript + React Router + TanStack Query. ESLint + Prettier + Vitest are set up and passing.

**Layout**: sidebar (role-aware — Analytics/Agents/IVR Builder/Call Forwarding only render for supervisors) + topbar (search, live-agent-count badge, self-service status control, dark-mode toggle) + a real active-call status bar.

**Pages**:
- `/` Dashboard — KPI cards, calls-by-hour chart, a capped "Live Now" panel, supervisor top-agents teaser (links to Analytics) or an individual agent's own performance.
- `/queue` Live Queue — who's actually on hold right now, with SLA row coloring.
- `/calls` Calls — Incoming / Outbound / Missed tabs, date-range + caller-number filters, pagination. Missed-call rows show whether they've already been called back (derived from later outbound call history, not a separate tracked flag) and let an agent call back with one click.
- `/tickets` Tags & Tickets — recent calls, the tickets table, a creation panel.
- `/analytics` Analytics (supervisors only) — today's totals, missed-call breakdown by reason, calls-by-hour, full agent performance leaderboard.
- `/agents` Agents (supervisors only) — roster grid with name/phone search, self-service status control reused here for supervisor overrides.
- `/ivr` IVR Builder (supervisors only) — editable greeting + per-digit menu with a live call-flow preview.
- `/forwarding` Call Forwarding (supervisors only) — Business Hours panel (open/close time, active days, after-hours message) plus the forwarding rules editor.

**Softphone** (`lib/softphone.tsx`): a real SIP.js WebRTC client that registers directly to Asterisk over WSS. Handles incoming/outgoing/active call state, a keepalive ping + automatic reconnection with re-registration for the transport (an idle tab's connection getting silently dropped by a proxy/NAT used to mean a softphone that never recovered without a manual page refresh), the presence heartbeat, and a guard against placing a second call while one is already active or ringing.

**Real-time-ish widgets**, mounted globally: `IncomingCallBanner` (urgent, gold/orange, browser Notification + synthesized ringtone), `OutgoingCallBanner` (calm, teal — the agent's own action, not an interruption), `StatusBar` (mute/hold/end/ticket controls for the active call), `WrapUpModal`, `QuickTicketModal`, `FloatingDialer`, `LiveAnalyticsBadge`.

**Theming**: a Moneto brand palette (teal primary/success, coral danger, dark navy for dark surfaces and the sidebar, gold-orange warning) via CSS custom properties in `styles.css`, with full dark-mode token overrides.

**Cross-cutting** (`lib/*`): `api.ts`, `auth.tsx`, `theme.tsx`, `toast.tsx`, `activeCall.tsx` (polls `/api/agents/me/active-call` every 5s, triggers wrap-up on the on_call→available transition), `useKeyboardShortcuts.ts`, `useModalA11y.ts`.

## Known limitations

- **No real-time push** — everything "live" here is a 5–30s poll (`refetchInterval` on the frontend, `setInterval` on the ARI app). A real push layer would mean Supabase Realtime subscriptions relayed to browsers, a bigger separate change.
- **`holdingBridge` singleton has a narrow race window** during creation/recovery — accepted, not yet fixed.
- **`busy`/`always` forwarding conditions** are saved but not applied to live routing — only `no_answer` is wired.
- **No server-side session revocation** — a removed/demoted agent's existing JWT stays valid until it naturally expires (up to 7 days).
- **Legacy AT phone-standby fallback is a dead end in practice** — see "Legacy Africa's Talking fallback" above.
- **Single-vCPU VPS**: Piper TTS synthesis fully serializes under concurrent load — mitigated by content-hash caching (a prompt is normally only synthesized once, ever) and an in-flight-promise lock preventing two concurrent requests for the same uncached text from racing.

## What's deliberately not built

1. Real-time push (see Known limitations).
2. Live routing for `busy`/`always` forwarding conditions.
3. A real fallback for agents without a softphone — the existing one doesn't work; nothing has replaced it yet.
4. Server-side session revocation.
5. Multi-country support — one Africa's Talking account covers every market they operate in, but there's no `country` column or per-country IVR/routing resolution yet.
