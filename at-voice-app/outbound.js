const AfricasTalking = require('africastalking');

module.exports = function (app) {

    const africastalking = AfricasTalking({
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME
    });

    const voice = africastalking.VOICE;
    const AT_NUMBER = process.env.AT_VOICE_NUMBER;

    // 🔧 Normalize phone to +254 format
    function normalize(phone) {
        if (!phone) return null;

        phone = phone.replace(/\s+/g, '').trim();

        if (phone.startsWith('+254')) return phone;

        if (phone.startsWith('254')) return '+' + phone;

        if (phone.startsWith('0')) return '+254' + phone.substring(1);

        return phone;
    }

    // 🔒 Validate Kenyan mobile numbers (supports Safaricom, Airtel, new ranges)
    function isValid(phone) {
        return /^\+254\d{9}$/.test(phone);
    }

    // 📞 CALL ROUTE (GET + POST supported)
    app.all('/call', async (req, res) => {
        console.log("🔥 /call route hit");

        let phone = req.body.phone || req.query.phone;

        if (!phone) {
            return res.status(400).send('Missing phone number');
        }

        phone = normalize(phone);

        if (!phone || !isValid(phone)) {
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
