const express = require('express');
const bodyParser = require('body-parser');

const app = express();

// Parse incoming POST data
app.use(bodyParser.urlencoded({ extended: false }));

// ✅ Health check
app.get('/', (req, res) => {
    res.send('✅ IVR app is running');
});

// 🎯 Step 1: Incoming call → IVR menu
app.post('/voice', (req, res) => {
    console.log('--- Incoming Call ---');
    console.log(req.body);

    const response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="woman">Welcome to chumz support. Press 1 for speak to a customer support champion. Press 2 for business hours.</Say>
    <GetDigits timeout="10" numDigits="1" callbackUrl="https://at-voice-app.onrender.com/handle-input"/>
</Response>`;

    res.set('Content-Type', 'application/xml');
    res.send(response);
});

// 🎯 Step 2: Handle key press
app.post('/handle-input', (req, res) => {
    console.log('--- User Input ---');
    console.log(req.body);

    const digit = req.body.digits;

    let response;

    if (digit === '1') {
        response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Connecting you to support</Say>
    <Dial phoneNumbers="+254706651053" record="true"/>
</Response>`;
    } 
    else if (digit === '2') {
        response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>We are open Monday to Friday, 8 AM to 5 PM. Goodbye.</Say>
</Response>`;
    } 
    else {
        response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Invalid input. Please try again.</Say>
    <Redirect>https://at-voice-app.onrender.com/voice</Redirect>
</Response>`;
    }

    res.set('Content-Type', 'application/xml');
    res.send(response);
});

// ✅ Start server (Render-compatible)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
