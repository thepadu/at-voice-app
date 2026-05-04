const AfricasTalking = require('africastalking');

module.exports = function (app) {

    const africastalking = AfricasTalking({
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME
    });

    const voice = africastalking.VOICE;
    const AT_NUMBER = process.env.AT_VOICE_NUMBER;

    // 📞 BASIC CALL TEST
    app.all('/call', async (req, res) => {
        console.log("🔥 /call route hit");

        try {
            const payload = {
                callFrom: AT_NUMBER,
                callTo: ['+254717134114'] // ✅ IMPORTANT: include +
            };

            console.log("📦 Payload:", payload);

            const response = await voice.call(payload);

            console.log("✅ Call response:", response);

            res.send('Call initiated');

        } catch (error) {
            console.error("❌ ERROR:", error);
            res.status(500).send('Call failed');
        }
    });

};
