const AfricasTalking = require('africastalking');

module.exports = function(app) {

    const africastalking = AfricasTalking({
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME
    });

    const voice = africastalking.VOICE;

    // 📞 Outbound Call Route
    app.post('/call', async (req, res) => {
        const phone = req.body.phone;

        if (!phone) {
            return res.send('Missing phone number');
        }

        try {
            const response = await voice.call({
                callFrom: '+254711082161', // your AT number
                callTo: [
                    { phoneNumber: '+254717134114' }, // agent
                    { phoneNumber: phone }           // customer
                ]
            });

            console.log('📞 Call started:', response);

            // redirect back to dashboard
            res.redirect('/dashboard');

        } catch (error) {
            console.error('❌ Call error:', error);
            res.send('Call failed');
        }
    });

};
