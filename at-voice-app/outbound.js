const { placeCall } = require('./lib/voice');
const { toE164, isValidE164 } = require('./lib/phone');

module.exports = function (app, requireAuth) {

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

        try {
            console.log("📞 Calling:", phone);

            const response = await placeCall(phone);

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
