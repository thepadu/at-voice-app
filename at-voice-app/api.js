// JSON API for the React web app (/web). Mirrors the data shown on the old
// HTML dashboard (dashboard.js) but as JSON instead of rendered markup — the
// two intentionally overlap in what they query rather than sharing code,
// since dashboard.js is stable/working and this is new surface area.
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

    // ── Agents ──────────────────────────────────────────────────────────
    // Anyone with dashboard access can manage agents/IVR for now — there's
    // no separate admin role yet (same as every other route on this app).

    const isValidPhone = phone => /^\+254\d{9}$/.test(phone || '');

    app.get('/api/agents', requireAuth, async (req, res) => {
        const { data, error } = await supabase.from('agents').select('*').order('id', { ascending: true });

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load agents' });
        }

        res.json({ agents: data });
    });

    app.post('/api/agents', requireAuth, async (req, res) => {
        const { name, phone, email } = req.body;

        if (!name || !isValidPhone(phone)) {
            return res.status(400).json({ error: 'Name and a valid +254 phone number are required' });
        }

        const { data, error } = await supabase
            .from('agents')
            .insert({ name, phone, email: email || null, status: 'offline' })
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to create agent' });
        }

        res.status(201).json({ agent: data });
    });

    app.patch('/api/agents/:id', requireAuth, async (req, res) => {
        const { id } = req.params;
        const { name, phone, email, status } = req.body;

        if (phone !== undefined && !isValidPhone(phone)) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }

        if (status !== undefined && !['available', 'offline'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (phone !== undefined) updates.phone = phone;
        if (email !== undefined) updates.email = email || null;
        if (status !== undefined) updates.status = status;

        const { data, error } = await supabase.from('agents').update(updates).eq('id', id).select().single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to update agent' });
        }

        res.json({ agent: data });
    });

    app.delete('/api/agents/:id', requireAuth, async (req, res) => {
        const { error } = await supabase.from('agents').delete().eq('id', req.params.id);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to delete agent' });
        }

        res.json({ ok: true });
    });

    // Lets an agent flip their own presence without knowing their agent id —
    // only works if their agents.email matches their Google login. Agents
    // seeded without a matching email (see migrations/003) need an admin to
    // toggle their status via PATCH /api/agents/:id instead, until someone
    // sets their email from the Agents page.
    app.patch('/api/agents/me/status', requireAuth, async (req, res) => {
        const { status } = req.body;

        if (!['available', 'offline'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const { data, error } = await supabase
            .from('agents')
            .update({ status })
            .eq('email', req.user.email)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'No agent record linked to your account yet' });
        }

        res.json({ agent: data });
    });

    // ── IVR menu options ───────────────────────────────────────────────

    app.get('/api/ivr-options', requireAuth, async (req, res) => {
        const { data, error } = await supabase.from('ivr_options').select('*').order('digit', { ascending: true });

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load IVR options' });
        }

        res.json({ options: data });
    });

    app.post('/api/ivr-options', requireAuth, async (req, res) => {
        const { digit, label, response_message, action } = req.body;

        if (!/^[0-9*#]$/.test(digit || '')) {
            return res.status(400).json({ error: 'digit must be a single key (0-9, *, #)' });
        }

        if (!label || !['message', 'transfer_agent', 'repeat_menu'].includes(action)) {
            return res.status(400).json({ error: 'label and a valid action are required' });
        }

        const { data, error } = await supabase
            .from('ivr_options')
            .insert({ digit, label, response_message: response_message || null, action })
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to create IVR option (digit may already exist)' });
        }

        res.status(201).json({ option: data });
    });

    app.patch('/api/ivr-options/:digit', requireAuth, async (req, res) => {
        const { label, response_message, action } = req.body;

        if (action !== undefined && !['message', 'transfer_agent', 'repeat_menu'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action' });
        }

        const updates = { updated_at: new Date().toISOString() };
        if (label !== undefined) updates.label = label;
        if (response_message !== undefined) updates.response_message = response_message;
        if (action !== undefined) updates.action = action;

        const { data, error } = await supabase
            .from('ivr_options')
            .update(updates)
            .eq('digit', req.params.digit)
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to update IVR option' });
        }

        res.json({ option: data });
    });

    app.delete('/api/ivr-options/:digit', requireAuth, async (req, res) => {
        const { error } = await supabase.from('ivr_options').delete().eq('digit', req.params.digit);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to delete IVR option' });
        }

        res.json({ ok: true });
    });
};
