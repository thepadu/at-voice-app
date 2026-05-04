const express = require('express');
const bodyParser = require('body-parser');

const app = express();

// Parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// ✅ Health check route (open in browser)
app.get('/', (req, res) => {
    res.send('✅ AT Voice app is running');
});

// 🎯 Voice callback endpoint
app.post('/voice', (req, res) => {
    console.log('--- Incoming Voice Request ---');
    console.log(req.body); // 🔥 Full debug payload

    const callerNumber = req.body.callerNumber || 'unknown';

    console.log("Incoming call from:", callerNumber);

    const response = `
        <Response>
            <Say voice="woman">Connecting your call now</Say>
            <Dial phoneNumbers="+254706651053" record="true"/>
        </Response>
    `;

    res.set('Content-Type', 'text/plain');
    res.send(response);
});

// ✅ Use dynamic port for Render
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
