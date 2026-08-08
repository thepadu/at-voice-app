const { placeCall } = require('./lib/voice');
const { toE164, isValidE164, normalizePhone } = require('./lib/phone');

module.exports = function (app, supabase, requireAuth) {

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

            // Best-effort: AT's call() response is assumed to carry the new
            // session_id under entries[0].sessionId (unverified — same
            // caveat as clientRequestId in lib/voice.js). Logging it now,
            // before /events ever fires, is what lets the dialer poll for
            // this specific call's status instead of showing a toast that
            // vanishes regardless of whether the call actually connected.
            const sessionId = response?.entries?.[0]?.sessionId;

            if (sessionId) {
                await supabase.from('call_logs').upsert({
                    session_id: sessionId,
                    caller: normalizePhone(phone),
                    direction: 'Outbound',
                    status: 'dialing'
                }, { onConflict: 'session_id' });
            }

            res.json({ ok: true, session_id: sessionId || null });

        } catch (error) {

            console.error("❌ RAW ERROR:", error);

            if (error.response) {
                console.error("❌ STATUS:", error.response.status);
                console.error("❌ DATA:", error.response.data);
            }

            console.error("❌ MESSAGE:", error.message);

            res.status(500).json({ error: 'Call failed' });
        }
    });

};
