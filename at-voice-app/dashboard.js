module.exports = function(app, supabase) {

    function formatOption(option) {
        if (option === '1') return { label: 'Login Issue', color: '#2563EB' };
        if (option === '2') return { label: 'Deposit Issue', color: '#F59E0B' };
        if (option === '3') return { label: 'Agent Request', color: '#10B981' };
        if (option === '9') return { label: 'Repeat Menu', color: '#6B7280' };
        return { label: option, color: '#6B7280' };
    }

    // 📊 DASHBOARD
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

        const total = data.length;
        const login = data.filter(d => d.option_pressed === '1').length;
        const deposit = data.filter(d => d.option_pressed === '2').length;
        const agent = data.filter(d => d.option_pressed === '3').length;

        let rows = '';

        data.forEach(row => {
            const option = formatOption(row.option_pressed);

            rows += `
            <tr>
                <td>
                    ${row.caller}
                    <form method="POST" action="/call" style="display:inline;">
                        <input type="hidden" name="phone" value="${row.caller}">
                        <button style="
                            margin-left:8px;
                            background:#0F9D58;
                            color:white;
                            border:none;
                            padding:5px 10px;
                            border-radius:6px;
                            cursor:pointer;
                        ">📞</button>
                    </form>
                </td>
                <td>
                    <span class="badge" style="background:${option.color}">
                        ${option.label}
                    </span>
                </td>
                <td>${new Date(row.created_at).toLocaleString()}</td>
            </tr>
            `;
        });

        const html = `
        <html>
        <head>
            <title>Chumz Dashboard</title>

            <meta http-equiv="refresh" content="10">

            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    background: #F5F7FB;
                    margin: 0;
                    padding: 0;
                    color: #1F2937;
                }

                .header {
                    background: #0F9D58;
                    color: white;
                    padding: 20px 30px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .export-btn {
                    background: white;
                    color: #0F9D58;
                    padding: 8px 14px;
                    border-radius: 6px;
                    text-decoration: none;
                    font-weight: bold;
                }

                .container {
                    padding: 25px;
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
                    border-radius: 12px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                    border-left: 5px solid #0F9D58;
                }

                .card p {
                    font-size: 24px;
                    font-weight: bold;
                    color: #0F9D58;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    background: white;
                    border-radius: 12px;
                    overflow: hidden;
                }

                th, td {
                    padding: 14px;
                    text-align: left;
                }

                th {
                    background: #0F9D58;
                    color: white;
                }

                tr:nth-child(even) {
                    background: #F9FAFB;
                }

                tr:hover {
                    background: #ECFDF5;
                }

                .badge {
                    padding: 6px 10px;
                    border-radius: 20px;
                    color: white;
                    font-size: 12px;
                }
            </style>
        </head>

        <body>

            <div class="header">
                <h2>💚 Chumz Support Dashboard</h2>
                <a href="/export" class="export-btn">⬇ Export</a>
            </div>

            <div class="container">

                <div class="cards">
                    <div class="card"><p>${total}</p>Total Calls</div>
                    <div class="card"><p>${login}</p>Login Issues</div>
                    <div class="card"><p>${deposit}</p>Deposit Issues</div>
                    <div class="card"><p>${agent}</p>Agent Requests</div>
                </div>

                <table>
                    <tr>
                        <th>Caller</th>
                        <th>Issue</th>
                        <th>Time</th>
                    </tr>
                    ${rows}
                </table>

            </div>

        </body>
        </html>
        `;

        res.send(html);
    });

    // 📥 EXPORT
    app.get('/export', async (req, res) => {
        const { data } = await supabase.from('call_logs').select('*');

        let csv = 'Caller,Issue,Time\n';

        data.forEach(row => {
            csv += `${row.caller},${row.option_pressed},${row.created_at}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.attachment('logs.csv');
        res.send(csv);
    });

};
