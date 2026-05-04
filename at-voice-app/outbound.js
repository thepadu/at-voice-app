const AfricasTalking = require('africastalking');

module.exports = function(app) {

    const africastalking = AfricasTalking({
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME
    });

    const voice = africastalking.VOICE;
    const AT_NUMBER = process.env.AT_VOICE_NUMBER;

    function isValid(phone) {
        return /^254(7|1)\d{8}$/.test(phone);
    }

    app.post('/call', async (req, res) => {
        let phone = req.body.phone;

        if (!phone) {
            return res.status(400).send('Missing phone number');
        }

        const normalize = app.locals.normalizePhone;
        phone = normalize(phone);

        if (!isValid(phone)) {
            return res.status(400).send('Invalid phone number');
        }

        try {
            console.log("📞 Calling:", phone);

            const response = await voice.call({
                callFrom: AT_NUMBER,
                callTo: [phone]
            });

            console.log('✅ Call started:', response);

            res.redirect('/dashboard');

        } catch (error) {
            console.error('❌ FULL ERROR:', JSON.stringify(error, null, 2));
            res.send('Call failed');
        }
    });
};
