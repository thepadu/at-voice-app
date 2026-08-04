# Chumz Call Center — React Web App System Design

## Context

The Chumz support tool started as an Africa's Talking IVR (`app.js`) with a server-rendered HTML dashboard (`dashboard.js`) — strings of markup built in Node. The team's other products are built in React, so the natural next step is to rebuild the dashboard as a proper React single-page app instead of hand-built HTML strings, and to give it the bigger feature set already scoped (call visibility, live queue, agent management, IVR editing, analytics, archiving, transfer).

**Principle for this whole effort: don't touch what works.** Africa's Talking's webhook contract (`/voice`, `/ivr`, `/handle-input`, `/events`) is unchanged — same URLs, same XML shape, same behavior on deploy day. What changed under the hood: `/ivr` and `/handle-input` now read the menu text and agent list from Supabase (`ivr_options`, `agents`) instead of hardcoded strings/arrays, so they're editable from the React app without a code deploy. The React app replaces `dashboard.js`'s *rendering*, talking to a new JSON API instead.

## Architecture

```
Africa's Talking ──► app.js (Express, unchanged)  ──► Supabase (call_logs)
   (voice webhooks)         │
                             ├── api.js      (JSON API, new)
                             ├── auth.js     (Google SSO, cookie session)
                             └── /web/dist   (React SPA, served as static files)

Browser ──► GET /  (or any non-API route) → React SPA (client-side routing)
        ──► GET /api/*                     → JSON, cookie-authenticated
```

One Express process serves everything — the React app is built (`vite build`) into static files and served by the same server that already runs the IVR and API, so there's no separate hosting/CORS setup and the existing Google SSO cookie just works across the whole app (same origin). `dashboard.js` (the old HTML version) can be deleted once the React app covers its functionality; it's left in place for now so nothing breaks mid-migration.

No new database is introduced. `call_logs` (plus `ticket_status`/`agent_number` from the earlier dashboard-upgrade migration) remains the single source of truth.

## Auth

Same Google SSO already built for the HTML dashboard, unchanged:
- `GET /login` → "Sign in with Google"
- `GET /auth/google` → redirect to Google
- `GET /auth/google/callback` → verifies the ID token, rejects anything outside `@chumz.io`, sets an `httpOnly` session cookie, redirects to `/`
- `GET /logout` → clears the cookie

Because the React app is served from the same origin as the API, the browser sends the session cookie automatically on every `fetch()` — no token storage, no `Authorization` headers, no client-side auth state beyond "did `/api/me` return 200 or 401." `requireAuth` (in `auth.js`) returns a JSON 401 for `/api/*` paths and a redirect for everything else, so the same middleware protects both the API and any lingering HTML routes.

## API contract (`api.js`)

All under `requireAuth`, all JSON, all same-origin (no CORS config needed):

- `GET /api/me` → `{ user: { email, name } }`
- `GET /api/calls?tab=all|incoming|outgoing|missed&option=&status=&ticket=&caller=&from=&to=` → `{ calls: [...], summary: { total, login, deposit, agentRequests, missed } }`
- `GET /api/calls/live` → in-flight calls (`ivr_started` / `input_received` / `ongoing`) — the "who's on queue" view
- `GET /api/agents/stats` → `[{ agent, total, answered, missed, avgHandleTime }]`
- `POST /api/calls/:sessionId/ticket` `{ ticket_status }` → updates ticket status
- `GET/POST /api/agents`, `PATCH/DELETE /api/agents/:id` → agent CRUD (`name`, `phone`, `email`, `status`)
- `PATCH /api/agents/me/status` `{ status }` → self-service presence toggle, matched by `req.user.email` against `agents.email`
- `GET /api/ivr-options`, `POST /api/ivr-options`, `PATCH/DELETE /api/ivr-options/:digit` → IVR menu CRUD (`digit`, `label`, `response_message`, `action`)

Placing an outbound call reuses the **existing** `POST /call` endpoint (`outbound.js`) directly. There's no separate admin role yet — any authenticated `@chumz.io` user can manage agents and the IVR menu, same as every other route on this app.

**Assumptions to verify**:
- "incoming" vs "outgoing" is inferred from the `direction` field Africa's Talking sends on `/events` (`'Outbound'` → outgoing, anything else → incoming), and "missed" is `status === 'failed'`. IVR-originated rows don't get a `direction` until the first `/events` callback lands. This is a v1 heuristic — confirm against real traffic, same caveat as the earlier `agent_number` tagging.
- Agent-transfer calls now dial every agent with `status = 'available'`, in `id` order, exactly like the old hardcoded two-number list — but with however many agents exist, not just two. Load-test with more than two available agents before relying on it for a busy period; the sequential `<Dial>...<Say>...<Dial>` XML chain hasn't been tried past two.

## React app (`/web`)

**Stack**: Vite + React + TypeScript + React Router. Vite over Create React App (unmaintained) or Next.js (its server-rendering/routing conventions solve problems this app doesn't have, since Express already serves everything from one origin). Plain `fetch` + a thin API client — no React Query/SWR yet; add one only once the number of data-fetching call sites actually justifies it.

### Pages (v1)

- `/` (Dashboard) — summary cards (`/api/calls`) + "Live now" section (`/api/calls/live`), polling every 10s like the current HTML dashboard
- `/calls` — tabbed list (All / Incoming / Outgoing / Missed), click a row to change its ticket status
- `/dialer` — phone input + call button, posts to `/call`
- `/agents` — **Team** (add/edit/remove agents, toggle presence — this is what call routing dials) + **Performance** (the stats table from `/api/agents/stats`)
- `/ivr` — the live IVR menu: one row per digit, editable label/message/action, add/remove digits entirely

### Structure

- `web/src/lib/api.ts` — thin `fetch` wrapper (`credentials: 'include'` so the cookie rides along; redirects to `/login` on 401; parses `{ error }` JSON bodies into a clean `ApiError.message`)
- `web/src/lib/auth.tsx` — a context that calls `/api/me` on load to know if anyone's signed in, exposes `user`
- `web/src/lib/toast.tsx` — app-wide toast notifications (`useToast()`) for save/error feedback, since silent saves (or a bare `alert()`) don't feel like a real product
- `web/src/pages/*` — one file per page above
- `web/src/components/*` — `StatusPill` (color-coded status/ticket/presence badge, one visual language across every page) and `ConfirmDialog` (used before every destructive action — deleting an agent or an IVR option). Pulled out once two pages needed the same thing, not built speculatively upfront.

Buttons, form inputs, modals, and toasts are plain CSS classes (`.btn`, `.modal`, `.toast`, etc. in `styles.css`) rather than React component wrappers — there's no shared *behavior* beyond styling yet, so a component would just be indirection. Worth revisiting once (if) the styling itself needs to vary by context.

## What's built vs. deferred

**Built now**: the full JSON API above, and all six pages/routes, wired to real data — including agent presence (which now actually drives who gets dialed) and a live IVR editor (which now actually drives what callers hear).

**Deferred, in the order I'd tackle them next** (each still needs its own scoping pass before building, same as the SSO phase):

1. **Agent analytics** — trend charts on top of `/api/agents/stats`.
2. **Archive call logs** — `archived` flag + retention action.
3. **Call transfer / conference** — needs a research spike into what Africa's Talking's Voice API actually supports for mid-call control before committing to an approach. Don't build this against a guessed API shape.
4. **Retire `dashboard.js`** — once the React app covers everything it does, delete the HTML version rather than maintaining two dashboards. It's currently out of sync with the new Agents/IVR data model (it still shows agent phone numbers with no way to edit them), so don't treat it as a fallback if the React app has issues — fix forward instead.
5. **Role-based permissions** — right now every `@chumz.io` login can edit agents and the IVR menu. Fine for a small team; revisit if that stops being true.
6. **UI polish** — once the above land and real usage surfaces what's actually clunky.

## Verification

I could not run `npm install`, `node`, or the Vite dev server in this environment (no Node available), so none of this has been executed — only reviewed by hand. When you're back:

1. **Run `migrations/003_agents_and_ivr.sql`** in the Supabase SQL editor before deploying — it creates `agents`/`ivr_options` and seeds them with the exact two phone numbers and four menu options that were previously hardcoded, so the IVR says/does the same thing on deploy as it did before. Edit those seeded rows (real agent names/emails, menu wording) from the new `/agents` and `/ivr` pages once it's live.
2. **Backend**: `cd at-voice-app && npm install && npm start` locally with your Supabase env vars, then hit `/login` → complete the Google flow → confirm `/api/me`, `/api/calls`, `/api/calls/live`, `/api/agents`, `/api/agents/stats`, `/api/ivr-options` all return sane JSON with the session cookie attached.
3. **Frontend**: see `web/README.md` for exact install steps. I hand-wrote `web/package.json` without being able to run npm's own resolver, so treat versions there as a starting point — run `npm install` and let it correct anything that doesn't resolve, and use `npm run build` to confirm the production build (the thing Express actually serves) works, not just `npm run dev`.
4. Confirm the AT webhooks (`/voice`, `/ivr`, `/handle-input`, `/events`) still respond without auth, and that a real call through the "speak to an agent" option still reaches a phone — the sequential `<Dial>` chain is now built from however many `agents` rows are `available` instead of a fixed two, and that path can only really be checked with a live test call.
5. In `/agents`, toggle an agent to "available"/"offline" and confirm it's reflected on the next test call (available agents get dialed, offline ones don't). In `/ivr`, edit a menu option's wording and confirm the next call's `<Say>` reflects it.
