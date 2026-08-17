const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const { normalizePhone } = require('./lib/phone');
const { getAgentPhones } = require('./lib/agentCache');

const authRoutes = require('./auth');
const apiRoutes = require('./api');

// Express 4 does not route a rejected promise from an async route handler
// to any error middleware — it just becomes an "unhandled rejection" at the
// Node process level, which (Node 15+) terminates the process by default.
// Almost none of the routes below wrap their async body in try/catch (they
// mostly rely on Supabase returning `{error}` rather than throwing), so
// without this, a single unexpected error from any request — a library
// behaving differently than expected, a malformed payload reaching code
// that doesn't guard for it — would crash the server for every connected
// user, not just the one request. Logging and continuing turns that into a
// contained per-request failure instead. Registered before anything else
// so it's active for the entire process lifetime, including module init.
process.on('unhandledRejection', reason => {
    console.error('❌ Unhandled promise rejection:', reason);
});

// A genuinely uncaught synchronous exception means some code ran in a state
// nothing anticipated — safer to log it and let the process exit (Render
// restarts the container automatically) than to keep serving requests from
// a process whose state integrity is no longer guaranteed.
process.on('uncaughtException', err => {
    console.error('❌ Uncaught exception, exiting:', err);
    process.exit(1);
});

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const { requireAuth, requireSupervisor } = authRoutes(app, supabase);

const STANDBY_TIMEOUT = 30;
const QUEUE_NAME = 'support-queue';
// Stale across the Render->DO migration once already (this hardcoded value
// used to be the old onrender.com URL) — an env var this time so the next
// domain change doesn't silently break the non-SIP agent standby loop again.
const BASE_URL = process.env.BASE_URL || 'https://calls.chumz.online';

// None of /voice, /agent-standby, /agent-standby-input, /events run through
// requireAuth — they're Africa's Talking's own webhook callbacks, which
// can't carry an agent's session cookie. Without any check at all, though,
// they're wide open: /agent-standby-input's agentId is a small guessable
// integer, and hitting it directly flips that agent to on_call and marks
// the oldest genuinely-waiting customer's call_logs row 'ongoing' — making
// them silently vanish from the Live Queue dashboard while still actually
// waiting. Opt-in (not enforced until the env var is set) because these
// URLs are registered as static callback URLs in Africa's Talking's own
// dashboard — turning this on requires adding `?secret=...` there too,
// which isn't something this code can do on its own.
const AT_WEBHOOK_SECRET = process.env.AT_WEBHOOK_SECRET;
function verifyAtWebhookSecret(req, res, next) {
    if (!AT_WEBHOOK_SECRET) {
        console.warn(`⚠️  AT_WEBHOOK_SECRET not set — ${req.path} is reachable without authentication`);
        return next();
    }
    if (req.query.secret !== AT_WEBHOOK_SECRET) {
        return res.status(403).send('Forbidden');
    }
    next();
}
// Appended to every URL this app itself generates for Africa's Talking to
// call back into (the standby loop's own redirects) — the one URL it can't
// cover is /voice itself, since that's the static callback registered
// directly in Africa's Talking's dashboard, not something built here.
const secretParam = AT_WEBHOOK_SECRET ? `&secret=${AT_WEBHOOK_SECRET}` : '';

// Routes
apiRoutes(app, supabase, requireAuth, requireSupervisor);

// Health check for DO App Platform's readiness/liveness probes — kept
// separate from '/' so visitors hitting the bare domain land in the
// actual dashboard instead of a bare status string.
app.get('/healthz', (req, res) => {
    res.send('✅ Chumz IVR running');
});

app.get('/', (req, res) => {
    res.redirect('/app');
});

// Old server-rendered dashboard is gone — send bookmarks to the React app.
app.get('/dashboard', (req, res) => {
    res.redirect('/app');
});


// 🔹 ENTRY — Africa's Talking's account-wide voice callback URL. Real
// inbound customer calls no longer arrive here at all — they're routed by
// a SIP trunk directly into the self-hosted Asterisk/ARI stack (see
// ari-app/), which is why this no longer has an IVR-menu branch (the old
// /ivr and /handle-input routes, and the ivr_config/ivr_options-reading
// helpers they used, were removed with it). The only thing that can still
// reach this URL is our own outbound call to a non-SIP-provisioned agent
// going "available" (api.js's setAgentStatus, via lib/voice.js) — tagged
// with clientRequestId `agent-standby:{id}` so it's identifiable here.
//
// NOTE: even that fallback is currently a dead end in practice — the
// standby loop below (`/agent-standby-input`) dequeues from an Africa's
// Talking `<Enqueue>` queue that only ever got populated by the
// now-removed /handle-input. Nothing enqueues a caller into it anymore, so
// an agent in this loop will always hear "No calls waiting." Left in place
// since ripping it out entirely means deciding what a non-SIP agent going
// "available" should do instead — a product decision, not a cleanup one.
app.post('/voice', verifyAtWebhookSecret, (req, res) => {
    res.set('Content-Type', 'application/xml');

    const standbyMatch = /^agent-standby:(\d+)$/.exec(req.body.clientRequestId || '');

    if (standbyMatch) {
        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                `<Redirect>${BASE_URL}/agent-standby?agentId=${standbyMatch[1]}${secretParam}</Redirect>` +
            '</Response>');
    }

    // Nothing else should be reaching this URL anymore.
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
});


// 🔹 AGENT STANDBY LOOP — reached when an agent answers the outbound call
// placed by going "available" (see api.js). Keeps their line open and
// listening for a digit press, which is the only way to trigger a Dequeue
// (Africa's Talking has no API to inject new instructions into a live call
// from our server — the trigger must come from inside the call itself).
app.post('/agent-standby', verifyAtWebhookSecret, async (req, res) => {
    const agentId = req.query.agentId;

    await supabase.from('agents').update({ status: 'available' }).eq('id', agentId);

    res.set('Content-Type', 'application/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            '<Say>You are now online for Chumz support calls.</Say>' +
            `<GetDigits timeout="${STANDBY_TIMEOUT}" numDigits="1" callbackUrl="${BASE_URL}/agent-standby-input?agentId=${agentId}${secretParam}">` +
                '<Say>Press 1 to check for a waiting call.</Say>' +
            '</GetDigits>' +
            `<Redirect>${BASE_URL}/agent-standby?agentId=${agentId}${secretParam}</Redirect>` +
        '</Response>');
});

app.post('/agent-standby-input', verifyAtWebhookSecret, async (req, res) => {
    const agentId = req.query.agentId;

    res.set('Content-Type', 'application/xml');

    // Whoever has been waiting longest — see the note in SYSTEM_DESIGN.md
    // about this being a best-effort "who's next" indicator, not a
    // guarantee: Dequeue itself decides who actually gets bridged, and if
    // two agents check at nearly the same moment this read isn't atomic
    // against that.
    const { data: waiting } = await supabase
        .from('call_logs')
        .select('session_id')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (waiting) {
        const { data: agent } = await supabase.from('agents').select('phone').eq('id', agentId).single();

        // Mark the row 'ongoing' right here, at the exact moment we know
        // it's actually being bridged — don't wait on /events to get there.
        // /events sets 'ongoing' too, but only from a generic "is this call
        // active" signal that can't tell "on hold in the queue" apart from
        // "just bridged to an agent" (a caller in <Enqueue> is itself still
        // an active call from AT's perspective) — see the guard there.
        await Promise.all([
            supabase.from('agents').update({ status: 'on_call' }).eq('id', agentId),
            supabase.from('call_logs')
                .update({ status: 'ongoing', agent_number: agent ? normalizePhone(agent.phone) : undefined })
                .eq('session_id', waiting.session_id)
        ]);

        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                `<Dequeue name="${QUEUE_NAME}"/>` +
                `<Redirect>${BASE_URL}/agent-standby?agentId=${agentId}${secretParam}</Redirect>` +
            '</Response>');
    }

    res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            '<Say>No calls waiting right now.</Say>' +
            `<Redirect>${BASE_URL}/agent-standby?agentId=${agentId}${secretParam}</Redirect>` +
        '</Response>');
});


// 🔹 EVENTS CALLBACK (UPSERT)
app.post('/events', verifyAtWebhookSecret, async (req, res) => {
    console.log('📡 EVENT:', req.body);

    const {
        sessionId,
        isActive,
        durationInSeconds,
        direction,
        callerNumber,
        destinationNumber
    } = req.body;

    const caller = normalizePhone(callerNumber);
    const destination = normalizePhone(destinationNumber);

    let status = 'unknown';

    if (isActive === '1') status = 'ongoing';
    if (isActive === '0' && durationInSeconds > 0) status = 'completed';
    if (isActive === '0' && durationInSeconds == 0) status = 'failed';

    // A caller sitting in <Enqueue> hold is itself still an "active" call
    // from AT's perspective, so isActive alone can't distinguish "on hold"
    // from "just bridged to an agent" — that would flip the row to 'ongoing'
    // the moment this fires while someone's still genuinely waiting,
    // vanishing them from the Live Queue page before any agent picked up.
    // /agent-standby-input owns the real queued→ongoing transition (it
    // knows for certain a Dequeue is happening); this only guards against
    // this handler racing ahead of it.
    const { data: existingRow } = await supabase
        .from('call_logs')
        .select('status')
        .eq('session_id', sessionId)
        .maybeSingle();

    if (existingRow?.status === 'queued' && status === 'ongoing') {
        status = 'queued';
    }

    // Dial/standby legs to an agent land here as their own event. We tag
    // them with agent_number for stats. Presence transitions to
    // 'available'/'on_call' are owned by /agent-standby and
    // /agent-standby-input (they know precisely what's happening); this
    // handler only reacts to the whole call ending, since that's the one
    // agent-presence transition nothing else observes.
    // NOTE: field name/behavior assumed from AT's docs — confirm against the
    // "📡 EVENT" log on a live call before relying on this.
    const agentPhones = await getAgentPhones(supabase, normalizePhone);
    const matchedAgent = agentPhones.find(a => a.normalized === destination);

    if (matchedAgent && (status === 'completed' || status === 'failed')) {
        await supabase.from('agents').update({ status: 'offline' }).eq('phone', matchedAgent.phone);
    }

    await supabase.from('call_logs').upsert({
        session_id: sessionId,
        caller,
        agent_number: matchedAgent ? destination : undefined,
        status,
        duration: durationInSeconds,
        direction
    }, { onConflict: 'session_id' });

    res.sendStatus(200);
});


// 🔹 REACT WEB APP (built via `npm run build` in /web, served under /app)
const webBuildPath = path.join(__dirname, '..', 'web', 'dist');
app.use('/app', express.static(webBuildPath));
app.get(['/app', '/app/*'], (req, res) => {
    res.sendFile(path.join(webBuildPath, 'index.html'), err => {
        if (err) res.status(404).send('Web app not built — run `npm run build` in /web first.');
    });
});

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});

// DO App Platform sends SIGTERM on every redeploy/restart. Without this, a
// request in flight at that exact instant (an agent action, an AT /events
// callback) gets hard-killed mid-response instead of finishing normally —
// server.close() stops accepting new connections but lets in-flight ones
// complete; the timeout is a backstop against a request that never finishes
// on its own, so a deploy can't hang indefinitely waiting to exit.
process.on('SIGTERM', () => {
    console.log('⏳ SIGTERM received, closing server gracefully…');
    server.close(() => {
        console.log('✅ Server closed, exiting');
        process.exit(0);
    });
    setTimeout(() => {
        console.error('⚠️ Graceful shutdown timed out, forcing exit');
        process.exit(1);
    }, 10000).unref();
});
