const AfricasTalking = require('africastalking');

module.exports = function(app) {

  const africastalking = AfricasTalking({
    apiKey: process.env.AT_API_KEY,
    username: process.env.AT_USERNAME
  });

  const voice = africastalking.VOICE;

  const AT_NUMBER = process.env.AT_VOICE_NUMBER;

  // 🔧 Helper: format phone numbers
  function formatPhone(phone) {
    if (!phone) return null;

    phone = phone.trim();

    if (phone.startsWith('0')) {
      return '254' + phone.substring(1);
    }

    if (phone.startsWith('+254')) {
      return phone.substring(1);
    }

    return phone;
  }

  // 📞 Trigger outbound call
  app.post('/call', async (req, res) => {
    const phone = req.body.phone;

    if (!phone) {
      return res.send('Missing phone number');
    }

    if (!AT_NUMBER) {
      console.error('❌ AT_VOICE_NUMBER is not set');
      return res.send('Server config error');
    }

    const customer = formatPhone(phone);

    try {
      console.log("📞 Calling:", customer);

      const response = await voice.call({
        callFrom: AT_NUMBER,
        to: [customer]
      });

      console.log('✅ Call initiated:', response);

      res.redirect('/dashboard');

    } catch (error) {
      console.error('❌ Call error:', error.response?.data || error.message);
      res.send('Call failed');
    }
  });

  // ☎️ Voice callback
  app.post('/voice', (req, res) => {
    const isActive = req.body.isActive;

    let response = '<?xml version="1.0" encoding="UTF-8"?>';

    if (isActive === '1') {
      response += `
        <Response>
          <Say voice="woman">Please wait while we connect your call.</Say>
          <Dial phoneNumbers="254717134114" record="true"/>
        </Response>
      `;
    } else {
      response += `
        <Response>
          <Say>Goodbye</Say>
        </Response>
      `;
    }

    res.set('Content-Type', 'text/xml');
    res.send(response);
  });

};
