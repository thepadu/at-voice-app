const AfricasTalking = require('africastalking');

module.exports = function(app) {

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

    // 🔒 Stricter validation (reduces AT rejections)
    function isValid(phone) {
        return /^254(7[0-9]|11[0-5])\d{7}$/.test(phone);
    }

    app.post('/call', async (req, res) => {
        let phone = req.body.phone;

        if (!phone) {
            return res.status(400).send('Missing phone number');
        }

        // 🔧 Normalize
        phone = normalize(phone);

        // 🔒 Validate
        if (!isValid(phone)) {
            console.log("❌ Invalid format:", phone);
            return res.status(400).send('Invalid or unsupported phone number');
        }

        // 🔴 Critical config check
        if (!AT_NUMBER) {
            console.error("❌ AT_VOICE_NUMBER not set");
            return res.status(500).send('Server misconfigured');
        }

        try {
            console.log("📞 Calling:", phone);

            // 🔍 Log exact payload (very useful)
            console.log("Payload:", {
                callFrom: AT_NUMBER,
                callTo: [phone]
            });

            const response = await voice.call({
                callFrom: AT_NUMBER,   // must be +254...
                callTo: [phone]        // must be 254...
            });

            console.log('✅ Call started:', response);

            res.redirect('/dashboard');

        } catch (error) {
            console.error('❌ AT ERROR:', error.response?.data || error.message);

            res.status(500).send(
                error.response?.data || 'Call failed'
            );
        }
    });
};
