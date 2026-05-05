const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const dashboardRoutes = require('./dashboard');
const outboundRoutes = require('./outbound');

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

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
dashboardRoutes(app, supabase);
outboundRoutes(app);

// Health
app.get('/', (req, res) => {
    res.send('✅ Chumz IVR running');
});


// 🎯 VOICE ENTRY (ROUTER)
app.post('/voice', (req, res) => {
    console.log("📥 Voice event:", req.body);

    const direction = req.body.direction;

    let response = '<?xml version="1.0" encoding="UTF-8"?>';

    // 📞 OUTBOUND → CONNECT TO AGENT
    if (direction === 'outbound') {
        response += `
        <Response>
            <Say>Please wait while we connect your call</Say>
            <Dial phoneNumbers="+254717134114" record="true"/>
        </Response>`;
    }

    // ☎️ INBOUND → IVR MENU
    else {
        response += `
        <Response>
            <GetDigits timeout="10" numDigits="1" finishOnKey="#" callbackUrl="https://at-voice-app.onrender.com/handle-input">
                <Say>
                Welcome to Chumz customer support.
                Press 1 for login issues.
                Press 2 for deposit issues.
                Press 3 to speak to a support agent.
                Press 9 to repeat this menu.
                </Say>
            </GetDigits>
            <Redirect>https://at-voice-app.onrender.com/voice</Redirect>
        </Response>`;
    }

    res.set('Content-Type', 'text/xml');
    res.send(response);
});


// 🎯 HANDLE INPUT (IVR LOGIC)
app.post('/handle-input', async (req, res) => {
    console.log("📥 IVR input:", req.body);

    const digit = req.body.dtmfDigits || req.body.digits;
    const caller = normalizePhone(req.body.callerNumber);
    const sessionId = req.body.sessionId;

    await supabase.from('call_logs').insert([
        {
            caller,
            option_pressed: digit,
            session_id: sessionId,
            status: 'menu'
        }
    ]);

    let response = '<?xml version="1.0" encoding="UTF-8"?>';

    if (digit === '3') {
        response += `
        <Response>
            <Say>Connecting you to a support agent</Say>
            <Dial phoneNumbers="+254717134114" record="true"/>
        </Response>`;
    } else {
        response += `
        <Response>
            <Say>Thank you. Goodbye.</Say>
        </Response>`;
    }

    res.set('Content-Type', 'text/xml');
    res.send(response);
});


// 📡 EVENTS CALLBACK (CALL STATUS)
app.post('/events', async (req, res) => {
    console.log('📡 EVENT:', req.body);

    const {
        sessionId,
        isActive,
        durationInSeconds,
        direction,
        callerNumber
    } = req.body;

    const caller = normalizePhone(callerNumber);

    let status = 'unknown';

    if (isActive === '1') status = 'ongoing';
    if (isActive === '0' && durationInSeconds > 0) status = 'completed';
    if (isActive === '0' && durationInSeconds == 0) status = 'failed';

    await supabase.from('call_logs').insert([
        {
            caller,
            session_id: sessionId,
            status,
            duration: durationInSeconds,
            direction
        }
    ]);

    res.sendStatus(200);
});


// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
