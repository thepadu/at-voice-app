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
                <td>${row.caller}</td>
                <td>
                    <span class="badge" style="background:${option.color}">
                        ${option.label}
                    </span>
                </td>
                <td>${new Date(row.created_at).toLocaleString()}</td>
            </tr>
            
         
            <tr>
                <td>
                    ${row.caller}
                    <form method="POST" action="/call" style="display:inline;">
                        <input type="hidden" name="phone" value="${row.caller}">
                        <button style="margin-left:8px;">📞</button>
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

                .header h1 {
                    margin: 0;
                    font-size: 20px;
                }

                .export-btn {
                    background: white;
                    color: #0F9D58;
                    padding: 8px 14px;
                    border-radius: 6px;
                    text-decoration: none;
                    font-weight: bold;
                    font-size: 14px;
                }

                .export-btn:hover {
                    background: #ECFDF5;
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

                .card h3 {
                    margin: 0;
                    font-size: 14px;
                    color: #6B7280;
                }

                .card p {
                    font-size: 26px;
                    margin: 5px 0 0;
                    font-weight: bold;
                    color: #0F9D58;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    background: white;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
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
                    font-weight: 500;
                }
            </style>
        </head>

        <body>

            <div class="header">
                <h1>💚 Chumz Support Dashboard</h1>
                <a href="/export" class="export-btn">⬇ Export Excel</a>
            </div>

            <div class="container">

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

            </div>

        </body>
        </html>
        `;

        res.send(html);
    });

    // 📥 EXPORT CSV (Excel)
    app.get('/export', async (req, res) => {
        const { data, error } = await supabase
            .from('call_logs')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error(error);
            return res.send('Error exporting data');
        }

        function formatOption(option) {
            if (option === '1') return 'Login Issue';
            if (option === '2') return 'Deposit Issue';
            if (option === '3') return 'Agent Request';
            if (option === '9') return 'Repeat Menu';
            return option;
        }

        let csv = 'Caller,Issue,Time\n';

        data.forEach(row => {
            csv += `${row.caller},${formatOption(row.option_pressed)},${new Date(row.created_at).toLocaleString()}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.attachment('chumz-call-logs.csv');
        res.send(csv);
    });

};
