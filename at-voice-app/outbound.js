const AfricasTalking = require('africastalking');

module.exports = function (app) {

    const africastalking = AfricasTalking({
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME
    });

    const voice = africastalking.VOICE;
    const AT_NUMBER = process.env.AT_VOICE_NUMBER;

    // 📞 BASIC TEST CALL (NO FORMATTING, NO VALIDATION)
    app.get('/call', async (req, res) => {
        try {
            console.log("📞 Initiating test call...");

            const response = await voice.call({
                callFrom: AT_NUMBER,
                callTo: ['254717134114'] // 🔁 replace with YOUR phone
            });

            console.log("✅ Call response:", response);

            res.send('Call initiated');

        } catch (error) {
            console.error("❌ ERROR:", error);
            res.send('Call failed');
        }
    });

};
