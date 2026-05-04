const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Health check
app.get('/', (req, res) => {
    res.send('✅ IVR app is running');
});

// Step 1: Incoming call → show menu
app.post('/voice', (req, res) => {
    console.log('--- Incoming Call ---');
    console.log(req.body);

    const response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <GetDigits timeout="10" numDigits="1" callbackUrl="/handle-input">
        <Say voice="woman">
            Welcome. Press 1 to speak to support. 
            Press 2 for business hours.
        </Say>
    </GetDigits>

    <Say>No input received. Goodbye.</Say>
</Response>`;

    res.set('Content-Type', 'text/plain');
    res.send(response);
});

// Step 2: Handle user input
app.post('/handle-input', (req, res) => {
    console.log('--- User Input ---');
    console.log(req.body);

    const digit = req.body.digits;

    let response;

    if (digit === '1') {
        // Connect to your phone
        response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Connecting you to support</Say>
    <Dial phoneNumbers="+254706651053"/>
</Response>`;
    } else if (digit === '2') {
        // Play info
        response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>We are open Monday to Friday, 8 AM to 5 PM. Goodbye.</Say>
</Response>`;
    } else {
        // Invalid input
        response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Invalid input. Please try again.</Say>
    <Redirect>/voice</Redirect>
</Response>`;
    }

    res.set('Content-Type', 'text/plain');
    res.send(response);
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
