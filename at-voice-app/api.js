// JSON API for the React Native app. Mirrors the data shown on the HTML
// dashboard (dashboard.js) but as JSON instead of rendered markup — the two
// intentionally overlap in what they query rather than sharing code, since
// dashboard.js is stable/working and this is new surface area.
module.exports = function (app, supabase, requireAuth) {

    // A row is a pure agent-leg record (see dashboard.js) — exclude it from
    // caller-facing call lists, it only feeds agent stats.
    function isAgentLegRow(row) {
        return !!row.agent_number && !row.option_pressed;
    }

    // Best-effort direction classification. IVR-originated rows often don't
    // have `direction` set until the /events callback lands, so absence of
    // an explicit 'Outbound' is treated as incoming. Verify against real
    // traffic before relying on this for anything business-critical.
    function classifyDirection(row) {
        if (row.direction === 'Outbound') return 'outgoing';
        return 'incoming';
    }

    function isMissed(row) {
        return row.status === 'failed';
    }

    app.get('/api/me', requireAuth, (req, res) => {
        res.json({ user: req.user });
    });

    // GET /api/calls?tab=all|incoming|outgoing|missed&option=&status=&ticket=&caller=&from=&to=
    app.get('/api/calls', requireAuth, async (req, res) => {
        const { tab, from, to, option, status, ticket, caller } = req.query;

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
            return res.status(500).json({ error: 'Failed to load calls' });
        }

        let calls = data.filter(row => !isAgentLegRow(row));

        if (tab === 'incoming') calls = calls.filter(row => classifyDirection(row) === 'incoming');
        if (tab === 'outgoing') calls = calls.filter(row => classifyDirection(row) === 'outgoing');
        if (tab === 'missed') calls = calls.filter(isMissed);

        res.json({
            calls,
            summary: {
                total: calls.length,
                login: calls.filter(c => c.option_pressed === '1').length,
                deposit: calls.filter(c => c.option_pressed === '2').length,
                agentRequests: calls.filter(c => c.option_pressed === '3').length,
                missed: calls.filter(isMissed).length
            }
        });
    });

    // GET /api/calls/live — calls currently in the IVR or mid-conversation.
    // This is the "who's on queue" view: it's a live snapshot of in-flight
    // calls, not a real hold queue (Africa's Talking's basic Voice API
    // doesn't give us position-in-queue — see SYSTEM_DESIGN.md).
    app.get('/api/calls/live', requireAuth, async (req, res) => {
        const { data, error } = await supabase
            .from('call_logs')
            .select('*')
            .in('status', ['ivr_started', 'input_received', 'ongoing'])
            .order('created_at', { ascending: false });

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load live calls' });
        }

        res.json({ calls: data.filter(row => !isAgentLegRow(row)) });
    });

    app.get('/api/agents/stats', requireAuth, async (req, res) => {
        const { data, error } = await supabase
            .from('call_logs')
            .select('agent_number, status, duration')
            .not('agent_number', 'is', null);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load agent stats' });
        }

        const stats = {};
        data.forEach(row => {
            const key = row.agent_number;
            if (!stats[key]) stats[key] = { agent: key, total: 0, answered: 0, missed: 0, durationSum: 0 };
            stats[key].total++;
            if (row.status === 'completed') {
                stats[key].answered++;
                stats[key].durationSum += row.duration || 0;
            } else if (row.status === 'failed' || row.status === 'unknown') {
                stats[key].missed++;
            }
        });

        res.json({
            agents: Object.values(stats).map(s => ({
                agent: s.agent,
                total: s.total,
                answered: s.answered,
                missed: s.missed,
                avgHandleTime: s.answered ? Math.round(s.durationSum / s.answered) : 0
            }))
        });
    });

    app.post('/api/calls/:sessionId/ticket', requireAuth, async (req, res) => {
        const { sessionId } = req.params;
        const { ticket_status } = req.body;

        if (!['open', 'in_progress', 'resolved'].includes(ticket_status)) {
            return res.status(400).json({ error: 'Invalid ticket status' });
        }

        const { error } = await supabase
            .from('call_logs')
            .update({ ticket_status })
            .eq('session_id', sessionId);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to update ticket' });
        }

        res.json({ ok: true });
    });
};
