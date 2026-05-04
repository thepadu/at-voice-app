module.exports = function(app, supabase) {

    function formatOption(option) {
        if (option === '1') return 'Login Issue';
        if (option === '2') return 'Deposit Issue';
        if (option === '3') return 'Speak to Agent';
        if (option === '9') return 'Repeat Menu';
        return option;
    }

    app.get('/dashboard', async (req, res) => {
        const { data, error } = await supabase
            .from('call_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error(error);
            return res.send('Error loading dashboard');
        }

        let html = `
        <h2>📊 Chumz Call Logs</h2>
        <table border="1" cellpadding="10" style="border-collapse: collapse;">
            <tr>
                <th>Caller</th>
                <th>Option</th>
                <th>Time</th>
            </tr>
        `;

        data.forEach(row => {
            html += `
            <tr>
                <td>${row.caller}</td>
                <td>${formatOption(row.option_pressed)}</td>
                <td>${new Date(row.created_at).toLocaleString()}</td>
            </tr>
            `;
        });

        html += `</table>`;

        res.send(html);
    });

};
