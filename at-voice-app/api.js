const { isValidE164 } = require('./lib/phone');
const { invalidateAgentCache } = require('./lib/agentCache');

// JSON API for the React web app (/web). Mirrors the data shown on the old
// HTML dashboard (dashboard.js, now removed) but as JSON instead of rendered
// markup.
module.exports = function (app, supabase, requireAuth, requireSupervisor) {

    // A row is a pure agent-leg record (see app.js's /events handler) —
    // exclude it from caller-facing call lists, it only feeds agent stats.
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
    // calls, not a real hold queue (see SYSTEM_DESIGN.md for what a real
    // queue via Africa's Talking's Enqueue/Dequeue actions would take).
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

    // A bare count, not the roster itself — safe for the topbar's "N agents
    // live" badge to show to any authenticated user, unlike the full
    // roster (which is requireSupervisor-gated below, phone numbers/emails
    // included).
    app.get('/api/agents/available-count', requireAuth, async (req, res) => {
        const { count, error } = await supabase
            .from('agents')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'available');

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load agent count' });
        }

        res.json({ count: count ?? 0 });
    });

    // Any authenticated user can see performance numbers (an agent needs
    // their own for the Dashboard's "My performance" card) — but the
    // response is name-based, not phone-number-based, so plain agents don't
    // get a side-channel view of colleagues' raw phone numbers through an
    // endpoint that was never meant to expose the roster (that's
    // requireSupervisor-gated separately, below).
    app.get('/api/agents/stats', requireAuth, async (req, res) => {
        const [{ data: callData, error: callError }, { data: agentRows, error: agentError }] = await Promise.all([
            supabase.from('call_logs').select('agent_number, status, duration').not('agent_number', 'is', null),
            supabase.from('agents').select('id, name, phone')
        ]);

        if (callError || agentError) {
            console.error(callError || agentError);
            return res.status(500).json({ error: 'Failed to load agent stats' });
        }

        const nameByPhone = new Map(agentRows.map(a => [a.phone, a]));

        const stats = {};
        callData.forEach(row => {
            const key = row.agent_number;
            if (!stats[key]) stats[key] = { phone: key, total: 0, answered: 0, missed: 0, durationSum: 0 };
            stats[key].total++;
            if (row.status === 'completed') {
                stats[key].answered++;
                stats[key].durationSum += row.duration || 0;
            } else if (row.status === 'failed' || row.status === 'unknown') {
                stats[key].missed++;
            }
        });

        res.json({
            agents: Object.values(stats).map(s => {
                const agent = nameByPhone.get(s.phone);
                return {
                    id: agent?.id ?? null,
                    name: agent?.name ?? 'Unknown agent',
                    total: s.total,
                    answered: s.answered,
                    missed: s.missed,
                    avgHandleTime: s.answered ? Math.round(s.durationSum / s.answered) : 0
                };
            })
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

    // Lets an agent flip their own presence without knowing their agent id —
    // only works if their agents.email matches their Google login. Agents
    // seeded without a matching email need a supervisor to set their status
    // via the roster endpoints below instead, until their email is linked.
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

        invalidateAgentCache();
        res.json({ agent: data });
    });

    // ── Agent roster management (supervisors only) ─────────────────────
    // Full CRUD, including reads — the roster includes phone numbers and
    // emails, which plain agents have no need to see even though the page
    // showing it is also hidden from their nav.

    app.get('/api/agents', requireSupervisor, async (req, res) => {
        const { data, error } = await supabase.from('agents').select('*').order('id', { ascending: true });

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load agents' });
        }

        res.json({ agents: data });
    });

    app.post('/api/agents', requireSupervisor, async (req, res) => {
        const { name, phone, email, role } = req.body;

        if (!name || !isValidE164(phone)) {
            return res.status(400).json({ error: 'Name and a valid phone number (e.g. +254712345678) are required' });
        }

        if (role !== undefined && !['agent', 'supervisor'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const { data, error } = await supabase
            .from('agents')
            .insert({ name, phone, email: email || null, status: 'offline', role: role || 'agent' })
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to create agent' });
        }

        invalidateAgentCache();
        res.status(201).json({ agent: data });
    });

    app.patch('/api/agents/:id', requireSupervisor, async (req, res) => {
        const { id } = req.params;
        const { name, phone, email, status, role } = req.body;

        if (phone !== undefined && !isValidE164(phone)) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }

        if (status !== undefined && !['available', 'on_call', 'offline'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        if (role !== undefined && !['agent', 'supervisor'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (phone !== undefined) updates.phone = phone;
        if (email !== undefined) updates.email = email || null;
        if (status !== undefined) updates.status = status;
        if (role !== undefined) updates.role = role;

        const { data, error } = await supabase.from('agents').update(updates).eq('id', id).select().single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to update agent' });
        }

        invalidateAgentCache();
        res.json({ agent: data });
    });

    app.delete('/api/agents/:id', requireSupervisor, async (req, res) => {
        const { error } = await supabase.from('agents').delete().eq('id', req.params.id);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to delete agent' });
        }

        invalidateAgentCache();
        res.json({ ok: true });
    });

    // ── IVR menu (supervisors only) ─────────────────────────────────────

    app.get('/api/ivr-config', requireSupervisor, async (req, res) => {
        const { data, error } = await supabase.from('ivr_config').select('greeting').eq('id', 1).single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load IVR greeting' });
        }

        res.json({ greeting: data.greeting });
    });

    app.patch('/api/ivr-config', requireSupervisor, async (req, res) => {
        const { greeting } = req.body;

        if (!greeting || !greeting.trim()) {
            return res.status(400).json({ error: 'Greeting cannot be empty' });
        }

        const { error } = await supabase
            .from('ivr_config')
            .update({ greeting: greeting.trim(), updated_at: new Date().toISOString() })
            .eq('id', 1);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to update greeting' });
        }

        res.json({ ok: true });
    });

    app.get('/api/ivr-options', requireSupervisor, async (req, res) => {
        const { data, error } = await supabase.from('ivr_options').select('*').order('digit', { ascending: true });

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load IVR options' });
        }

        res.json({ options: data });
    });

    app.post('/api/ivr-options', requireSupervisor, async (req, res) => {
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

    app.patch('/api/ivr-options/:digit', requireSupervisor, async (req, res) => {
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

    app.delete('/api/ivr-options/:digit', requireSupervisor, async (req, res) => {
        const { error } = await supabase.from('ivr_options').delete().eq('digit', req.params.digit);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to delete IVR option' });
        }

        res.json({ ok: true });
    });
};
