const AfricasTalking = require('africastalking');
const { toE164, isValidE164 } = require('./lib/phone');

module.exports = function (app, requireAuth) {

    const africastalking = AfricasTalking({
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME
    });

    const voice = africastalking.VOICE;
    const AT_NUMBER = process.env.AT_VOICE_NUMBER;

    // 📞 CALL ROUTE (GET + POST supported)
    app.all('/call', requireAuth, async (req, res) => {
        console.log("🔥 /call route hit");

        let phone = req.body.phone || req.query.phone;

        if (!phone) {
            return res.status(400).send('Missing phone number');
        }

        phone = toE164(phone);

        if (!phone || !isValidE164(phone)) {
            console.log("❌ Invalid number:", phone);
            return res.status(400).send('Invalid phone number');
        }

        if (!AT_NUMBER) {
            console.error("❌ AT_VOICE_NUMBER not set");
            return res.status(500).send('Server misconfigured');
        }

        try {
            console.log("📞 Calling:", phone);

            const payload = {
                callFrom: AT_NUMBER,   // must be +254...
                callTo: [phone]        // must be +254...
            };

            console.log("📦 Payload:", payload);

            const response = await voice.call(payload);

            console.log("✅ Call started:", response);

            res.send(`Calling ${phone}`);

        } catch (error) {

            console.error("❌ RAW ERROR:", error);

            if (error.response) {
                console.error("❌ STATUS:", error.response.status);
                console.error("❌ DATA:", error.response.data);
            }

            console.error("❌ MESSAGE:", error.message);

            res.status(500).send('Call failed');
        }
    });

};
