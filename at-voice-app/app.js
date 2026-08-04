const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const authRoutes = require('./auth');
const apiRoutes = require('./api');
const dashboardRoutes = require('./dashboard');
const outboundRoutes = require('./outbound');

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const requireAuth = authRoutes(app);

const IVR_TIMEOUT = 7;

// 🔧 IVR menu + agent list are dashboard-editable (see api.js) — stored in
// Supabase's `ivr_options` and `agents` tables (migrations/003) instead of
// hardcoded here, so changing a prompt or adding/removing an agent doesn't
// need a code deploy.
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

// 🔧 Normalize phone
function normalizePhone(phone) {
    if (!phone) return null;
    phone = phone.replace(/\s+/g, '').trim();
    if (phone.startsWith('+254')) return phone.substring(1);
    if (phone.startsWith('0')) return '254' + phone.substring(1);
    return phone;
}

app.locals.normalizePhone = normalizePhone;

// Routes
apiRoutes(app, supabase, requireAuth);
dashboardRoutes(app, supabase, requireAuth);
outboundRoutes(app, requireAuth);

// Health
app.get('/', (req, res) => {
    res.send('✅ choomz IVR running');
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
// menu text and agent list are now dashboard-editable (by any authenticated
// @chumz.io user), so an admin typing "Terms & Conditions" shouldn't produce
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

    const options = await getIvrOptions();

    const menuText = options.length
        ? 'Welcome to choomz customer support. ' +
          options.map(o => `Press ${o.digit} for ${escapeXml(o.label)}.`).join(' ')
        : 'Welcome to choomz customer support. Our menu is temporarily unavailable, please try again shortly.';

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

        let body = `<Say>${escapeXml(option.response_message)}</Say>`;

        agents.forEach((agent, i) => {
            body += `<Dial phoneNumbers="${escapeXml(agent.phone)}" timeout="15" record="true"/>`;
            if (i < agents.length - 1) {
                body += '<Say>That agent did not pick up. Proceeding to the next available agent.</Say>';
            }
        });

        body += '<Say>All agents are currently unavailable. Please try again later. Goodbye.</Say>';

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
    // with agent_number so the dashboard can compute per-agent stats.
    // NOTE: field name/behavior assumed from AT's docs — confirm against the
    // "📡 EVENT" log on a live agent-transfer call before relying on this.
    const { data: allAgents } = await supabase.from('agents').select('phone');
    const agentPhones = (allAgents || []).map(a => normalizePhone(a.phone));
    const isAgentLeg = agentPhones.includes(destination);

    await supabase.from('call_logs').upsert({
        session_id: sessionId,
        caller,
        agent_number: isAgentLeg ? destination : undefined,
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


// 🔹 REACT WEB APP (built via `npm run build` in /web, served under /app)
// dashboard.js keeps serving the old HTML pages at '/' and '/dashboard' —
// this lives at a separate path rather than replacing them outright, so
// nothing breaks if the React app isn't built yet on a given deploy.
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
