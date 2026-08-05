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

// 🔧 IVR menu + agent list are dashboard-editable (see api.js) — stored in
// Supabase's `ivr_config`/`ivr_options` and `agents` tables (migrations
// 003/004) instead of hardcoded here, so changing a prompt or adding an
// agent doesn't need a code deploy.
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

async function getAvailableAgents() {
    const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('status', 'available')
        .order('id', { ascending: true });

    if (error) {
        console.error('❌ Failed to load agents:', error);
        return [];
    }

    return data;
}

// Routes
apiRoutes(app, supabase, requireAuth, requireSupervisor);
outboundRoutes(app, requireAuth);

// Health
app.get('/', (req, res) => {
    res.send('✅ Chumz IVR running');
});

// Old server-rendered dashboard is gone — send bookmarks to the React app.
app.get('/dashboard', (req, res) => {
    res.redirect('/app');
});


// 🔹 ENTRY
app.post('/voice', (req, res) => {
    res.set('Content-Type', 'application/xml');

    res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            '<Redirect>https://at-voice-app.onrender.com/ivr</Redirect>' +
        '</Response>');
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

            `<GetDigits timeout="${IVR_TIMEOUT}" numDigits="1" callbackUrl="https://at-voice-app.onrender.com/handle-input">` +
                `<Say>${menuText}</Say>` +
            '</GetDigits>' +

            '<Say>No option was selected.</Say>' +
            '<Redirect>https://at-voice-app.onrender.com/ivr</Redirect>' +

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
                '<Redirect>https://at-voice-app.onrender.com/ivr</Redirect>' +
            '</Response>');
    }

    if (option.action === 'repeat_menu') {
        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Redirect>https://at-voice-app.onrender.com/ivr</Redirect>' +
            '</Response>');
    }

    if (option.action === 'transfer_agent') {
        const agents = await getAvailableAgents();

        if (agents.length === 0) {
            return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
                '<Response>' +
                    '<Say>All agents are currently unavailable. Please try again later. Goodbye.</Say>' +
                '</Response>');
        }

        // Ring every available agent at once (sequential="false") instead of
        // one-after-another — with N agents, sequential dialing means up to
        // N × 15s of pure ringing before a caller even reaches someone.
        // Whoever picks up first gets the call.
        const phoneList = agents.map(a => escapeXml(a.phone)).join(',');

        const body =
            `<Say>${escapeXml(option.response_message)}</Say>` +
            `<Dial phoneNumbers="${phoneList}" sequential="false" timeout="15" record="true"/>` +
            '<Say>All agents are currently unavailable. Please try again later. Goodbye.</Say>';

        return res.send('<?xml version="1.0" encoding="UTF-8"?>' + '<Response>' + body + '</Response>');
    }

    // action === 'message'
    return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            `<Say>${escapeXml(option.response_message)}</Say>` +
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

    // Dial legs to a support agent land here as their own event. We tag them
    // with agent_number so the dashboard can compute per-agent stats, and
    // auto-track that agent's presence so a second, overlapping call doesn't
    // also ring them while they're mid-call.
    // NOTE: field name/behavior assumed from AT's docs — confirm against the
    // "📡 EVENT" log on a live agent-transfer call before relying on this.
    const agentPhones = await getAgentPhones(supabase, normalizePhone);
    const matchedAgent = agentPhones.find(a => a.normalized === destination);

    if (matchedAgent) {
        if (status === 'ongoing') {
            await supabase.from('agents').update({ status: 'on_call' })
                .eq('phone', matchedAgent.phone).eq('status', 'available');
        } else if (status === 'completed' || status === 'failed') {
            await supabase.from('agents').update({ status: 'available' })
                .eq('phone', matchedAgent.phone).eq('status', 'on_call');
        }
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


// 🔹 TICKET STATUS UPDATE
app.post('/ticket/:sessionId', requireAuth, async (req, res) => {
    const { sessionId } = req.params;
    const { ticket_status } = req.body;

    if (!['open', 'in_progress', 'resolved'].includes(ticket_status)) {
        return res.status(400).send('Invalid ticket status');
    }

    const { error } = await supabase
        .from('call_logs')
        .update({ ticket_status })
        .eq('session_id', sessionId);

    if (error) {
        console.error(error);
        return res.status(500).send('Failed to update ticket');
    }

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
