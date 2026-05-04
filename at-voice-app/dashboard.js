module.exports = function(app, supabase) {

    function formatOption(option) {
        if (option === '1') return 'Login Issue';
        if (option === '2') return 'Deposit Issue';
        if (option === '3') return 'Agent Request';
        if (option === '9') return 'Repeat Menu';
        return option;
    }

    app.get('/dashboard', async (req, res) => {
        const { data, error } = await supabase
            .from('call_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            console.error(error);
            return res.send('Error loading dashboard');
        }

        // 📊 Stats
        const total = data.length;
        const login = data.filter(d => d.option_pressed === '1').length;
        const deposit = data.filter(d => d.option_pressed === '2').length;
        const agent = data.filter(d => d.option_pressed === '3').length;

        let rows = '';

        data.forEach(row => {
            rows += `
            <tr>
                <td>${row.caller}</td>
                <td>${formatOption(row.option_pressed)}</td>
                <td>${new Date(row.created_at).toLocaleString()}</td>
            </tr>
            `;
        });

        const html = `
        <html>
        <head>
            <title>Chumz Dashboard</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background: #f5f7fb;
                    margin: 0;
                    padding: 20px;
                }

                h1 {
                    margin-bottom: 20px;
                }

                .cards {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 15px;
                    margin-bottom: 25px;
                }

                .card {
                    background: white;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                }

                .card h3 {
                    margin: 0;
                    font-size: 14px;
                    color: #777;
                }

                .card p {
                    font-size: 24px;
                    margin: 5px 0 0;
                    font-weight: bold;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    background: white;
                    border-radius: 10px;
                    overflow: hidden;
                }

                th, td {
                    padding: 12px;
                    text-align: left;
                }

                th {
                    background: #f0f2f5;
                }

                tr:nth-child(even) {
                    background: #fafafa;
                }
            </style>
        </head>
        <body>

            <h1>📊 Chumz Call Dashboard</h1>

            <div class="cards">
                <div class="card">
                    <h3>Total Calls</h3>
                    <p>${total}</p>
                </div>
                <div class="card">
                    <h3>Login Issues</h3>
                    <p>${login}</p>
                </div>
                <div class="card">
                    <h3>Deposit Issues</h3>
                    <p>${deposit}</p>
                </div>
                <div class="card">
                    <h3>Agent Requests</h3>
                    <p>${agent}</p>
                </div>
            </div>

            <table>
                <tr>
                    <th>Caller</th>
                    <th>Issue</th>
                    <th>Time</th>
                </tr>
                ${rows}
            </table>

        </body>
        </html>
        `;

        res.send(html);
    });
};
