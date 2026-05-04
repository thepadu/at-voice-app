const AfricasTalking = require('africastalking');

module.exports = function (app) {

    const africastalking = AfricasTalking({
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME
    });

    const voice = africastalking.VOICE;
    const AT_NUMBER = process.env.AT_VOICE_NUMBER;

    // 🔧 Normalize
    function normalize(phone) {
        if (!phone) return null;

        phone = phone.replace(/\s+/g, '').trim();

        if (phone.startsWith('0')) return '+254' + phone.substring(1);
        if (phone.startsWith('254')) return '+' + phone;

        return phone;
    }

    function isValid(phone) {
        return /^\+254(7\d{8}|11\d{7})$/.test(phone);
    }

    app.all('/call', async (req, res) => {
        console.log("🔥 /call route hit");

        let phone = req.body.phone || req.query.phone;

        if (!phone) {
            return res.status(400).send('Missing phone');
        }

        phone = normalize(phone);

        if (!isValid(phone)) {
            console.log("❌ Invalid:", phone);
            return res.status(400).send('Invalid phone');
        }

        try {
            const payload = {
                callFrom: AT_NUMBER,
                callTo: [phone]
            };

            console.log("📦 Payload:", payload);

            const response = await voice.call(payload);

            console.log("✅ Call started:", response);

            res.send('Calling ' + phone);

        } catch (error) {
            console.error("❌ ERROR:", error.response?.data || error.message);
            res.status(500).send('Call failed');
        }
    });
};
