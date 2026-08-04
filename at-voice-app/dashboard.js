module.exports = function(app, supabase, requireAuth) {

    const TICKET_STATUSES = ['open', 'in_progress', 'resolved'];

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatOption(option) {
        if (option === '1') return { label: 'Login Issue', color: '#2563EB' };
        if (option === '2') return { label: 'Deposit Issue', color: '#F59E0B' };
        if (option === '3') return { label: 'Agent Request', color: '#10B981' };
        if (option === '9') return { label: 'Repeat Menu', color: '#6B7280' };
        return { label: option || '—', color: '#6B7280' };
    }

    function formatStatus(status) {
        if (status === 'completed') return { label: 'Completed', color: '#10B981' };
        if (status === 'ongoing') return { label: 'Ongoing', color: '#3B82F6' };
        if (status === 'failed') return { label: 'Failed', color: '#EF4444' };
        return { label: status || 'Unknown', color: '#6B7280' };
    }

    function formatTicket(status) {
        if (status === 'in_progress') return { label: 'In Progress', color: '#F59E0B' };
        if (status === 'resolved') return { label: 'Resolved', color: '#10B981' };
        return { label: 'Open', color: '#EF4444' };
    }

    // A row is a pure agent-leg record (created from the /events callback for
    // the Dial to a support agent) if it carries an agent_number but never
    // went through the IVR menu. Those feed agent stats, not the call list.
    function isAgentLegRow(row) {
        return !!row.agent_number && !row.option_pressed;
    }

    // 📊 DASHBOARD
    app.get('/dashboard', requireAuth, async (req, res) => {
        const { from, to, option, status, ticket, caller } = req.query;

        let query = supabase
            .from('call_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);

        if (from) query = query.gte('created_at', `${from}T00:00:00`);
        if (to) query = query.lte('created_at', `${to}T23:59:59`);
        if (option) query = query.eq('option_pressed', option);
        if (status) query = query.eq('status', status);
        if (ticket) query = query.eq('ticket_status', ticket);
        if (caller) query = query.ilike('caller', `%${caller}%`);

        const { data, error } = await query;

        if (error) {
            console.error(error);
            return res.send('Error loading dashboard');
        }

        const rowsData = data.filter(row => !isAgentLegRow(row));

        const { data: agentData, error: agentError } = await supabase
            .from('call_logs')
            .select('agent_number, status, duration')
            .not('agent_number', 'is', null);

        if (agentError) console.error(agentError);

        const agentStats = {};
        (agentData || []).forEach(row => {
            const key = row.agent_number;
            if (!agentStats[key]) {
                agentStats[key] = { agent: key, total: 0, answered: 0, missed: 0, durationSum: 0 };
            }
            const stat = agentStats[key];
            stat.total++;
            if (row.status === 'completed') {
                stat.answered++;
                stat.durationSum += row.duration || 0;
            } else if (row.status === 'failed' || row.status === 'unknown') {
                stat.missed++;
            }
        });

        const agentRows = Object.values(agentStats).map(stat => ({
            ...stat,
            avgHandleTime: stat.answered ? Math.round(stat.durationSum / stat.answered) : 0
        }));

        const total = rowsData.length;
        const login = rowsData.filter(d => d.option_pressed === '1').length;
        const deposit = rowsData.filter(d => d.option_pressed === '2').length;
        const agent = rowsData.filter(d => d.option_pressed === '3').length;

        let rows = '';

        rowsData.forEach(row => {
            const optionFmt = formatOption(row.option_pressed);
            const statusFmt = formatStatus(row.status);
            const ticketFmt = formatTicket(row.ticket_status);
            const isLive = row.status === 'ongoing';

            rows += `
            <tr class="${isLive ? 'live-row' : ''}">
                <td>
                    ${escapeHtml(row.caller)}
                    <form method="POST" action="/call" style="display:inline;">
                        <input type="hidden" name="phone" value="${escapeHtml(row.caller)}">
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
                    <span class="badge" style="background:${optionFmt.color}">
                        ${optionFmt.label}
                    </span>
                </td>
                <td>
                    <span class="badge" style="background:${statusFmt.color}">
                        ${isLive ? '🔴 ' : ''}${statusFmt.label}
                    </span>
                </td>
                <td>${row.duration || 0}s</td>
                <td>${new Date(row.created_at).toLocaleString()}</td>
                <td>
                    <select
                        class="ticket-select"
                        style="background:${ticketFmt.color};"
                        onchange="updateTicket('${escapeHtml(row.session_id)}', this.value)"
                    >
                        ${TICKET_STATUSES.map(s => `
                            <option value="${s}" ${row.ticket_status === s || (!row.ticket_status && s === 'open') ? 'selected' : ''}>
                                ${formatTicket(s).label}
                            </option>
                        `).join('')}
                    </select>
                </td>
            </tr>
            `;
        });

        let agentRowsHtml = '';
        agentRows.forEach(stat => {
            agentRowsHtml += `
            <tr>
                <td>${escapeHtml(stat.agent)}</td>
                <td>${stat.total}</td>
                <td>${stat.answered}</td>
                <td>${stat.missed}</td>
                <td>${stat.avgHandleTime}s</td>
            </tr>
            `;
        });

        if (!agentRowsHtml) {
            agentRowsHtml = '<tr><td colspan="5" style="text-align:center;color:#6B7280;">No agent call data yet</td></tr>';
        }

        const optionSelected = v => option === v ? 'selected' : '';
        const statusSelected = v => status === v ? 'selected' : '';
        const ticketSelected = v => ticket === v ? 'selected' : '';

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

                .ticket-select {
                    color: white;
                    border: none;
                    padding: 6px 10px;
                    border-radius: 20px;
                    font-size: 12px;
                    cursor: pointer;
                }

                .dialer, .filters, .panel {
                    background:white;
                    padding:20px;
                    border-radius:12px;
                    margin-bottom:20px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                }

                .filters form {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                    align-items: flex-end;
                }

                .filters label {
                    display: block;
                    font-size: 12px;
                    color: #6B7280;
                    margin-bottom: 4px;
                }

                .filters input, .filters select {
                    padding: 8px;
                    border-radius: 8px;
                    border: 1px solid #ccc;
                }

                .filters .apply-btn {
                    background:#0F9D58;
                    color:white;
                    border:none;
                    padding:9px 15px;
                    border-radius:8px;
                    cursor:pointer;
                }

                .filters .clear-link {
                    color: #6B7280;
                    font-size: 13px;
                    align-self: center;
                }

                .panel h3 {
                    margin-top: 0;
                }

                .live-row {
                    animation: pulse-row 1.6s ease-in-out infinite;
                }

                @keyframes pulse-row {
                    0%, 100% { background: #FFFFFF; }
                    50% { background: #EFF6FF; }
                }
            </style>
        </head>

        <body>

            <div class="header">
                <h2>💚 Chumz Support Dashboard</h2>
                <div style="display:flex;align-items:center;gap:12px;">
                    <span style="font-size:13px;opacity:0.85;">${escapeHtml(req.user.email)}</span>
                    <a href="/export" class="export-btn">⬇ Export</a>
                    <a href="/logout" class="export-btn">Logout</a>
                </div>
            </div>

            <div class="container">

                <!-- 📞 DIALER -->
                <div class="dialer">
                    <h3>📞 Manual Dialer</h3>
                    <input id="dialerInput" placeholder="0712345678" style="padding:10px;border-radius:8px;border:1px solid #ccc;margin-right:10px;">
                    <button onclick="makeCall()" style="background:#0F9D58;color:white;border:none;padding:10px 15px;border-radius:8px;cursor:pointer;">
                        Call
                    </button>
                    <p id="dialerError" style="color:red;"></p>
                </div>

                <!-- 🔍 FILTERS -->
                <div class="filters">
                    <h3 style="margin-top:0;">🔍 Filters</h3>
                    <form method="GET" action="/dashboard">
                        <div>
                            <label>From</label>
                            <input type="date" name="from" value="${escapeHtml(from)}">
                        </div>
                        <div>
                            <label>To</label>
                            <input type="date" name="to" value="${escapeHtml(to)}">
                        </div>
                        <div>
                            <label>Issue</label>
                            <select name="option">
                                <option value="">All</option>
                                <option value="1" ${optionSelected('1')}>Login Issue</option>
                                <option value="2" ${optionSelected('2')}>Deposit Issue</option>
                                <option value="3" ${optionSelected('3')}>Agent Request</option>
                                <option value="9" ${optionSelected('9')}>Repeat Menu</option>
                            </select>
                        </div>
                        <div>
                            <label>Call Status</label>
                            <select name="status">
                                <option value="">All</option>
                                <option value="ivr_started" ${statusSelected('ivr_started')}>IVR Started</option>
                                <option value="input_received" ${statusSelected('input_received')}>Input Received</option>
                                <option value="ongoing" ${statusSelected('ongoing')}>Ongoing</option>
                                <option value="completed" ${statusSelected('completed')}>Completed</option>
                                <option value="failed" ${statusSelected('failed')}>Failed</option>
                            </select>
                        </div>
                        <div>
                            <label>Ticket</label>
                            <select name="ticket">
                                <option value="">All</option>
                                <option value="open" ${ticketSelected('open')}>Open</option>
                                <option value="in_progress" ${ticketSelected('in_progress')}>In Progress</option>
                                <option value="resolved" ${ticketSelected('resolved')}>Resolved</option>
                            </select>
                        </div>
                        <div>
                            <label>Caller</label>
                            <input type="text" name="caller" placeholder="254712..." value="${escapeHtml(caller)}">
                        </div>
                        <button type="submit" class="apply-btn">Apply</button>
                        <a href="/dashboard" class="clear-link">Clear</a>
                    </form>
                </div>

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
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Time</th>
                        <th>Ticket</th>
                    </tr>
                    ${rows}
                </table>

                <!-- 👤 AGENT PERFORMANCE -->
                <div class="panel" style="margin-top:25px;">
                    <h3>👤 Agent Performance</h3>
                    <table>
                        <tr>
                            <th>Agent</th>
                            <th>Total Calls</th>
                            <th>Answered</th>
                            <th>Missed</th>
                            <th>Avg Handle Time</th>
                        </tr>
                        ${agentRowsHtml}
                    </table>
                </div>

            </div>

            <script>
                function formatPhone(phone) {
                    phone = phone.replace(/\\s+/g, '').trim();
                    if (phone.startsWith('0')) return '254' + phone.substring(1);
                    if (phone.startsWith('+254')) return phone.substring(1);
                    return phone;
                }

                function isValid(phone) {
                    return /^254(7|1)\\d{8}$/.test(phone);
                }

                function makeCall() {
                    let input = document.getElementById('dialerInput');
                    let error = document.getElementById('dialerError');

                    let phone = formatPhone(input.value);

                    if (!isValid(phone)) {
                        error.innerText = "Enter a valid Kenyan number";
                        return;
                    }

                    error.innerText = "";

                    fetch('/call', {
                        method: 'POST',
                        headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ phone })
                    });

                    alert("📞 Calling " + phone);
                }

                function updateTicket(sessionId, ticketStatus) {
                    fetch('/ticket/' + encodeURIComponent(sessionId), {
                        method: 'POST',
                        headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ ticket_status: ticketStatus })
                    }).catch(err => console.error(err));
                }
            </script>

        </body>
        </html>
        `;

        res.send(html);
    });

    // 📥 EXPORT
    app.get('/export', requireAuth, async (req, res) => {
        const { data } = await supabase.from('call_logs').select('*');

        let csv = 'Caller,Issue,Status,Duration,Time,Ticket\n';

        data.forEach(row => {
            csv += `${row.caller},${row.option_pressed},${row.status || ''},${row.duration || 0},${row.created_at},${row.ticket_status || 'open'}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.attachment('logs.csv');
        res.send(csv);
    });

};
