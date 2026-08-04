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

// 🔧 CONFIG
const AGENTS = [
    "+254717134114",
    "+254740323941"
];

const IVR_TIMEOUT = 7;

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

    res.set('Content-Type', 'application/xml');

    res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +

            `<GetDigits timeout="${IVR_TIMEOUT}" numDigits="1" callbackUrl="https://at-voice-app.onrender.com/handle-input">` +
                '<Say>Welcome to choomz customer support. Press 1 for login issues. Press 2 for deposit issues. Press 3 to speak to a support agent. Press 9 to repeat this menu.</Say>' +
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

    if (digit === '1') {
        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Say>For login issues, please update the choomz app and reset your PIN. Goodbye.</Say>' +
            '</Response>');
    }

    if (digit === '2') {
        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Say>For deposit issues, please forward your M Pesa message to WhatsApp 0717134114. Goodbye.</Say>' +
            '</Response>');
    }

    if (digit === '3') {
        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +

                '<Say>Please hold as your call is transferred to an available agent.</Say>' +

                `<Dial phoneNumbers="${AGENTS[0]}" timeout="15" record="true"/>` +

                '<Say>The first agent did not pick. Proceeding to the next available agent.</Say>' +

                `<Dial phoneNumbers="${AGENTS[1]}" timeout="15" record="true"/>` +

                '<Say>All agents are currently unavailable. Please try again later. Goodbye.</Say>' +

            '</Response>');
    }

    if (digit === '9') {
        return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Redirect>https://at-voice-app.onrender.com/ivr</Redirect>' +
            '</Response>');
    }

    return res.send('<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            '<Say>Invalid input. Please try again.</Say>' +
            '<Redirect>https://at-voice-app.onrender.com/ivr</Redirect>' +
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
    const isAgentLeg = AGENTS.map(normalizePhone).includes(destination);

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
