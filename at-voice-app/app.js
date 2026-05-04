const express = require('express');
const bodyParser = require('body-parser');

const app = express();

// Parse incoming POST data
app.use(bodyParser.urlencoded({ extended: false }));

// ✅ Health check
app.get('/', (req, res) => {
    res.send('✅ Chumz IVR app is running');
});

// 🎯 STEP 1: Main Menu
app.post('/voice', (req, res) => {
    console.log('--- Incoming Call ---');
    console.log(req.body);

    const response =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            '<GetDigits timeout="10" numDigits="1" callbackUrl="https://at-voice-app.onrender.com/handle-input">' +
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

// 🔁 STEP 2: Retry Menu (if no input)
app.post('/retry', (req, res) => {
    console.log('--- Retry Menu ---');

    const response =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
            '<GetDigits timeout="10" numDigits="1" callbackUrl="https://at-voice-app.onrender.com/handle-input">' +
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

// 🎯 STEP 3: Handle Input
app.post('/handle-input', (req, res) => {
    console.log('--- User Input ---');
    console.log(req.body);

    const digit = req.body.digits;

    // ⏰ Business hours (8 AM - 5 PM)
    const now = new Date();
    const hour = now.getHours();
    const isBusinessHours = hour >= 8 && hour < 17;

    let response;

    if (digit === '1') {
        // Login issues
        response =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Say>' +
                'For login issues, please download the latest version of the Chumz app from the Play Store or App Store. ' +
                'Then reset your PIN using the forgot PIN option. Goodbye.' +
                '</Say>' +
            '</Response>';
    } 
    else if (digit === '2') {
        // Deposit issues
        response =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Say>' +
                'For missed deposits, please forward your M Pesa message to our WhatsApp line 0717134114 and we will help reconcile. Goodbye.' +
                '</Say>' +
            '</Response>';
    } 
    else if (digit === '3') {
        // Speak to agent
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
                    '<Say>' +
                    'Our support agents are currently unavailable. ' +
                    'Please contact us during working hours or send a message to our WhatsApp line 0717134114. Goodbye.' +
                    '</Say>' +
                '</Response>';
        }
    } 
    else if (digit === '9') {
        // Repeat menu
        response =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response>' +
                '<Redirect>https://at-voice-app.onrender.com/voice</Redirect>' +
            '</Response>';
    } 
    else {
        // Invalid input
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

// ✅ Start server (Render compatible)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
