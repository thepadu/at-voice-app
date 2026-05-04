const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const dashboardRoutes = require('./dashboard');
const outboundRoutes = require('./outbound');

const app = express();

// Parse POST data
app.use(bodyParser.urlencoded({ extended: false }));

// Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// Initialize dashboard routes
dashboardRoutes(app, supabase);
outboundRoutes(app);

// Health check
app.get('/', (req, res) => {
    res.send('✅ Chumz IVR app is running');
});

// 🎯 MAIN MENU
app.post('/voice', (req, res) => {
    console.log('--- Incoming Call ---');
    console.log(req.body);

    const response =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            '<GetDigits timeout="10" numDigits="1" finishOnKey="#" callbackUrl="https://at-voice-app.onrender.com/handle-input">' +
                '<Say>' +
                'Welcome to Chumz customer support. ' +
                'Press 1 for login issues. ' +
                'Press 2 for deposit issues. ' +
                'Press 3 to speak to a support agent. ' +
                'Press 9 to repeat this menu.' +
                '</Say>' +
            '</GetDigits>' +
            '<Redirect>https://at-voice-app.onrender.com/retry</Redirect>' +
        '</Response>';

    res.set('Content-Type', 'application/xml');
    res.send(response);
});

// 🔁 RETRY MENU
app.post('/retry', (req, res) => {
    console.log('--- Retry Menu ---');

    const response =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            '<GetDigits timeout="10" numDigits="1" finishOnKey="#" callbackUrl="https://at-voice-app.onrender.com/handle-input">' +
                '<Say>' +
                'We did not receive your input. ' +
                'Press 1 for login issues. ' +
                'Press 2 for deposit issues. ' +
                'Press 3 to speak to a support agent. ' +
                'Press 9 to repeat this menu.' +
                '</Say>' +
            '</GetDigits>' +
            '<Say>No input received. Goodbye.</Say>' +
        '</Response>';

    res.set('Content-Type', 'application/xml');
    res.send(response);
});

// 🎯 HANDLE INPUT
app.post('/handle-input', async (req, res) => {
    console.log('--- User Input ---');
    console.log(req.body);

    const digit = req.body.dtmfDigits || req.body.digits;
    const caller = req.body.callerNumber;
    const sessionId = req.body.sessionId;

    // Save to Supabase
    const { error } = await supabase.from('call_logs').insert([
        {
            caller: caller,
            option_pressed: digit,
            session_id: sessionId
        }
    ]);

    if (error) {
        console.error('Supabase insert error:', error);
    }

    const now = new Date();
    const hour = now.getHours();
    const isBusinessHours = hour >= 8 && hour < 17;

    let response;

    if (digit === '1') {
        response =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Say>For login issues, please update the Chumz app and reset your PIN. Goodbye.</Say>' +
            '</Response>';
    } 
    else if (digit === '2') {
        response =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Say>For missed deposits, forward your M Pesa message to our WhatsApp line 0717134114. Goodbye.</Say>' +
            '</Response>';
    } 
    else if (digit === '3') {
        if (isBusinessHours) {
            response =
                '<?xml version="1.0" encoding="UTF-8"?>' +
                '<Response>' +
                    '<Say>Connecting you to a support agent</Say>' +
                    '<Dial phoneNumbers="+254717134114" record="true"/>' +
                '</Response>';
        } else {
            response =
                '<?xml version="1.0" encoding="UTF-8"?>' +
                '<Response>' +
                    '<Say>Our agents are unavailable. Please contact us during working hours or WhatsApp 0717134114.</Say>' +
                '</Response>';
        }
    } 
    else if (digit === '9') {
        response =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Redirect>https://at-voice-app.onrender.com/voice</Redirect>' +
            '</Response>';
    } 
    else {
        response =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Say>Invalid input. Please try again.</Say>' +
                '<Redirect>https://at-voice-app.onrender.com/voice</Redirect>' +
            '</Response>';
    }

    res.set('Content-Type', 'application/xml');
    res.send(response);
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
