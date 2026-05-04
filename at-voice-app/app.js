const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

app.post('/voice', (req, res) => {
    const callerNumber = req.body.callerNumber;

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});