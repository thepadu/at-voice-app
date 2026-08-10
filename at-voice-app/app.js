const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const { normalizePhone } = require('./lib/phone');
const { getAgentPhones } = require('./lib/agentCache');

const authRoutes = require('./auth');
const apiRoutes = require('./api');
const outboundRoutes = require('./outbound');

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

const IVR_TIMEOUT = 7;
const STANDBY_TIMEOUT = 30;
const QUEUE_NAME = 'support-queue';
const BASE_URL = 'https://at-voice-app.onrender.com';

// 🔧 IVR menu is dashboard-editable (see api.js) — stored in Supabase's
// `ivr_config`/`ivr_options` tables (migrations 004) instead of hardcoded
// here, so changing a prompt doesn't need a code deploy.
async function getIvrGreeting() {
    const { data, error } = await supabase.from('ivr_config').select('greeting').eq('id', 1).single();

    if (error) {
        console.error('❌ Failed to load ivr_config:', error);
        return 'Welcome to Chumz customer support.';
    }

    return data.greeting;
}

async function getIvrOptions() {
    const { data, error } = await supabase
        .from('ivr_options')
        .select('*')
        .order('digit', { ascending: true });

    if (error) {
        console.error('❌ Failed to load ivr_options:', error);
        return [];
    }

    return data;
}

// Routes
apiRoutes(app, supabase, requireAuth, requireSupervisor);
outboundRoutes(app, supabase, requireAuth);

// Health
app.get('/', (req, res) => {
    res.send('✅ Chumz IVR running');
});

// Old server-rendered dashboard is gone — send bookmarks to the React app.
app.get('/dashboard', (req, res) => {
    res.redirect('/app');
});


// XML-escape dynamic text before embedding it in a voice response — the IVR
// menu text and agent list are dashboard-editable (by any authenticated
// supervisor), so someone typing "Terms & Conditions" shouldn't produce
// invalid XML.
function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}


// 🔹 ENTRY — the single voice callback URL configured on the AT account for
// every call (inbound customer calls AND our own outbound calls, once
// answered — AT has no per-call callback override, see lib/voice.js).
// clientRequestId is how we tell an agent-standby call apart from a regular
// inbound customer call landing here.
app.post('/voice', (req, res) => {
    res.set('Content-Type', 'application/xml');

    const standbyMatch = /^agent-standby:(\d+)$/.exec(req.body.clientRequestId || '');

    if (standbyMatch) {
        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                `<Redirect>${BASE_URL}/agent-standby?agentId=${standbyMatch[1]}</Redirect>` +
            '</Response>');
    }

    res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            `<Redirect>${BASE_URL}/ivr</Redirect>` +
        '</Response>');
});


// 🔹 IVR MENU + LOG ENTRY
app.post('/ivr', async (req, res) => {

    const caller = normalizePhone(req.body.callerNumber);
    const sessionId = req.body.sessionId;

    // ✅ Log IVR start
    await supabase.from('call_logs').upsert({
        session_id: sessionId,
        caller,
        status: 'ivr_started'
    }, { onConflict: 'session_id' });

    const [greeting, options] = await Promise.all([getIvrGreeting(), getIvrOptions()]);

    const menuText = options.length
        ? `${greeting.trim()} ` + options.map(o => `Press ${o.digit} for ${escapeXml(o.label)}.`).join(' ')
        : `${greeting.trim()} Our menu is temporarily unavailable, please try again shortly.`;

    res.set('Content-Type', 'application/xml');

    res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +

            `<GetDigits timeout="${IVR_TIMEOUT}" numDigits="1" callbackUrl="${BASE_URL}/handle-input">` +
                `<Say>${menuText}</Say>` +
            '</GetDigits>' +

            '<Say>No option was selected.</Say>' +
            `<Redirect>${BASE_URL}/ivr</Redirect>` +

        '</Response>');
});


// 🔹 HANDLE INPUT + LOG
app.post('/handle-input', async (req, res) => {

    const digit = req.body.dtmfDigits || req.body.digits;
    const caller = normalizePhone(req.body.callerNumber);
    const sessionId = req.body.sessionId;

    // ✅ Log input
    await supabase.from('call_logs').upsert({
        session_id: sessionId,
        caller,
        option_pressed: digit,
        status: 'input_received'
    }, { onConflict: 'session_id' });

    res.set('Content-Type', 'application/xml');

    const options = await getIvrOptions();
    const option = options.find(o => o.digit === digit);

    if (!option) {
        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Say>Invalid input. Please try again.</Say>' +
                `<Redirect>${BASE_URL}/ivr</Redirect>` +
            '</Response>');
    }

    if (option.action === 'repeat_menu') {
        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                `<Redirect>${BASE_URL}/ivr</Redirect>` +
            '</Response>');
    }

    if (option.action === 'transfer_agent') {
        // Real hold queue (Enqueue/Dequeue) instead of directly dialing
        // agents — see SYSTEM_DESIGN.md for why (the only Africa's Talking
        // browser-calling SDK is an abandoned package; this rests on their
        // actually-supported phone-based queueing instead).
        await supabase.from('call_logs').upsert({
            session_id: sessionId,
            caller,
            status: 'queued'
        }, { onConflict: 'session_id' });

        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                `<Say>${escapeXml(option.response_message)}</Say>` +
                `<Enqueue name="${QUEUE_NAME}"/>` +
            '</Response>');
    }

    // action === 'message'
    return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            `<Say>${escapeXml(option.response_message)}</Say>` +
        '</Response>');
});


// 🔹 AGENT STANDBY LOOP — reached when an agent answers the outbound call
// placed by going "available" (see api.js). Keeps their line open and
// listening for a digit press, which is the only way to trigger a Dequeue
// (Africa's Talking has no API to inject new instructions into a live call
// from our server — the trigger must come from inside the call itself).
app.post('/agent-standby', async (req, res) => {
    const agentId = req.query.agentId;

    await supabase.from('agents').update({ status: 'available' }).eq('id', agentId);

    res.set('Content-Type', 'application/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            '<Say>You are now online for Chumz support calls.</Say>' +
            `<GetDigits timeout="${STANDBY_TIMEOUT}" numDigits="1" callbackUrl="${BASE_URL}/agent-standby-input?agentId=${agentId}">` +
                '<Say>Press 1 to check for a waiting call.</Say>' +
            '</GetDigits>' +
            `<Redirect>${BASE_URL}/agent-standby?agentId=${agentId}</Redirect>` +
        '</Response>');
});

app.post('/agent-standby-input', async (req, res) => {
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
                `<Redirect>${BASE_URL}/agent-standby?agentId=${agentId}</Redirect>` +
            '</Response>');
    }

    res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            '<Say>No calls waiting right now.</Say>' +
            `<Redirect>${BASE_URL}/agent-standby?agentId=${agentId}</Redirect>` +
        '</Response>');
});


// 🔹 EVENTS CALLBACK (UPSERT)
app.post('/events', async (req, res) => {
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


// 🔹 CSV EXPORT
app.get('/export', requireAuth, async (req, res) => {
    const { data, error } = await supabase.from('call_logs').select('*');

    if (error) {
        console.error(error);
        return res.status(500).send('Failed to export calls');
    }

    let csv = 'Caller,Issue,Status,Duration,Time,Ticket\n';

    data.forEach(row => {
        csv += `${row.caller},${row.option_pressed},${row.status || ''},${row.duration || 0},${row.created_at},${row.ticket_status || 'open'}\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('logs.csv');
    res.send(csv);
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
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
