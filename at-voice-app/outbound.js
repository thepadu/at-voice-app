app.all('/call', async (req, res) => {
    console.log("🔥 /call route hit");

    try {
        const payload = {
            callFrom: AT_NUMBER,
            callTo: ['+254717134114'] // ✅ FIXED FORMAT
        };

        console.log("📦 Payload:", payload);

        const response = await voice.call(payload);

        console.log("✅ Call response:", response);

        res.send('Call initiated');

    } catch (error) {
        console.error("❌ ERROR:", error);
        res.send('Call failed');
    }
});
