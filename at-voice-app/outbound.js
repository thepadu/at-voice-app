const AfricasTalking = require('africastalking');

module.exports = function (app) {

    const africastalking = AfricasTalking({
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME
    });

    const voice = africastalking.VOICE;
    const AT_NUMBER = process.env.AT_VOICE_NUMBER;

    // 🔧 Normalize phone
    function normalize(phone) {
        if (!phone) return null;

        phone = phone.replace(/\s+/g, '').trim();

        if (phone.startsWith('+254')) return phone.substring(1);
        if (phone.startsWith('0')) return '254' + phone.substring(1);

        return phone;
    }

    // 🔒 Validate Kenyan numbers (practical ranges)
    function isValid(phone) {
        return /^254(7\d{8}|11\d{7})$/.test(phone);
    }

    app.post('/call', async (req, res) => {
        let phone = req.body.phone;

        if (!phone) {
            return res.status(400).send('Missing phone number');
        }

        // 🔧 Normalize
        phone = normalize(phone);

        if (!phone) {
            return res.status(400).send('Invalid phone input');
        }

        // 🔒 Validate
        if (!isValid(phone)) {
            console.log('❌ Invalid format:', phone);
            return res.status(400).send('Invalid or unsupported phone number');
        }

        // 🔴 Config check
        if (!AT_NUMBER) {
            console.error('❌ AT_VOICE_NUMBER not set');
            return res.status(500).send('Server misconfigured');
        }

        try {
            console.log('📞 Calling:', phone);

            const payload = {
                callFrom: AT_NUMBER,   // must be +254...
                callTo: [phone]        // must be 254...
            };

            console.log('📦 Payload:', payload);

            const response = await voice.call(payload);

            console.log('✅ Call started:', response);

            return res.redirect('/dashboard');

        } catch (error) {

            console.error('❌ RAW ERROR:', error);

            if (error.response) {
                console.error('❌ STATUS:', error.response.status);
                console.error('❌ DATA:', error.response.data);
            }

            if (error.request) {
                console.error('❌ NO RESPONSE RECEIVED');
            }

            console.error('❌ MESSAGE:', error.message);

            return res.status(500).send('Call failed');
        }
    });
};
