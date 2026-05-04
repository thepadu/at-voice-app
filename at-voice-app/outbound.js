const AfricasTalking = require('africastalking');

module.exports = function (app) {

    const africastalking = AfricasTalking({
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME
    });

    const voice = africastalking.VOICE;
    const AT_NUMBER = process.env.AT_VOICE_NUMBER;

    // 📞 BASIC CALL TEST (handles GET + POST)
    app.all('/call', async (req, res) => {
        console.log("🔥 /call route hit");

        if (!AT_NUMBER) {
            console.error("❌ AT_VOICE_NUMBER not set");
            return res.status(500).send('Server misconfigured');
        }

        try {
            console.log("📞 Initiating test call...");

            const payload = {
                callFrom: AT_NUMBER,
                callTo: ['254717134114'] // 🔁 replace with your phone
            };

            console.log("📦 Payload:", payload);

            const response = await voice.call(payload);

            console.log("✅ Call response:", response);

            return res.send('Call initiated');

        } catch (error) {
            console.error("❌ RAW ERROR:", error);

            if (error.response) {
                console.error("❌ STATUS:", error.response.status);
                console.error("❌ DATA:", error.response.data);
            }

            console.error("❌ MESSAGE:", error.message);

            return res.status(500).send('Call failed');
        }
    });

};
