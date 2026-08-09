const { isValidE164 } = require('./lib/phone');
const { invalidateAgentCache } = require('./lib/agentCache');
const { placeCall } = require('./lib/voice');

// JSON API for the React web app (/web). Mirrors the data shown on the old
// HTML dashboard (dashboard.js, now removed) but as JSON instead of rendered
// markup.
module.exports = function (app, supabase, requireAuth, requireSupervisor) {

    // A row is a pure agent-leg record (see app.js's /events handler) —
    // exclude it from caller-facing call lists, it only feeds agent stats.
    // Real outbound calls (agent dialing out via the browser softphone) also
    // carry agent_number with no option_pressed, but are explicitly tagged
    // direction='Outbound' and must NOT be swept up by this heuristic.
    function isAgentLegRow(row) {
        return !!row.agent_number && !row.option_pressed && row.direction !== 'Outbound';
    }

    // Cheap enough at this project's scale to just fetch and map by phone
    // per-request (same pattern GET /api/agents/stats already uses) rather
    // than a SQL join — the agents table is tiny.
    async function attachAgentNames(rows) {
        const { data: agentRows } = await supabase.from('agents').select('phone, name');
        const nameByPhone = new Map((agentRows || []).map(a => [a.phone, a.name]));
        return rows.map(row => ({ ...row, agent_name: row.agent_number ? nameByPhone.get(row.agent_number) ?? null : null }));
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

    // Going "available" means different things depending on how this agent
    // actually takes calls:
    //  - Agents with a real WebRTC softphone (a row in agent_sip_credentials,
    //    provisioned on the self-hosted Asterisk box) just need the DB flag
    //    flipped — the ARI app rings their *browser* directly the moment it
    //    sees status='available', so placing a real phone call here would be
    //    actively wrong (a stray billed call unrelated to the softphone).
    //  - Agents never migrated to a softphone fall back to the original
    //    behavior: a real outbound call that brings them onto the old
    //    phone-standby hold-queue loop (see app.js's /agent-standby), so
    //    nothing already depending on that path breaks.
    async function setAgentStatus(agent, status) {
        if (status !== 'available') {
            return supabase.from('agents').update({ status }).eq('id', agent.id).select().single();
        }

        const { data: sipCreds } = await supabase
            .from('agent_sip_credentials')
            .select('agent_id')
            .eq('agent_id', agent.id)
            .maybeSingle();

        if (sipCreds) {
            return supabase.from('agents').update({ status: 'available' }).eq('id', agent.id).select().single();
        }

        await supabase.from('agents').update({ status: 'ringing' }).eq('id', agent.id);

        try {
            await placeCall(agent.phone, `agent-standby:${agent.id}`);
        } catch (error) {
            console.error(`❌ Failed to call agent ${agent.id} for standby:`, error.message);
            await supabase.from('agents').update({ status: 'offline' }).eq('id', agent.id);
            throw new Error('Could not reach that number — check it and try again');
        }

        return supabase.from('agents').select().eq('id', agent.id).single();
    }

    app.get('/api/me', requireAuth, (req, res) => {
        res.json({ user: req.user });
    });

    // GET /api/calls?tab=all|incoming|outgoing|missed&option=&status=&ticket=&caller=&from=&to=
    // GET /api/calls?tab=...&page=1&pageSize=50 — tab/isAgentLegRow filtering
    // happens in JS (see below), so pagination is applied after that rather
    // than via a SQL .range(), which would need every one of those filters
    // translated into (and correctly composed as) PostgREST query params —
    // riskier to get subtly wrong than fetching a wide-enough page and
    // slicing it. Fine at this project's scale; worth revisiting only if
    // call_logs grows enough that a 2000-row fetch itself becomes the
    // bottleneck (see SYSTEM_DESIGN.md).
    app.get('/api/calls', requireAuth, async (req, res) => {
        const { tab, from, to, option, status, ticket, caller } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));

        let query = supabase
            .from('call_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(2000);

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

        const summary = {
            total: calls.length,
            login: calls.filter(c => c.option_pressed === '1').length,
            deposit: calls.filter(c => c.option_pressed === '2').length,
            agentRequests: calls.filter(c => c.option_pressed === '3').length,
            missed: calls.filter(isMissed).length
        };

        const rangeStart = (page - 1) * pageSize;
        const pageOfCalls = await attachAgentNames(calls.slice(rangeStart, rangeStart + pageSize));

        res.json({
            calls: pageOfCalls,
            page,
            pageSize,
            total: calls.length,
            totalPages: Math.max(1, Math.ceil(calls.length / pageSize)),
            summary
        });
    });

    // GET /api/calls/live — every call currently in flight (IVR, queued, or
    // mid-conversation). Used by the Dashboard's "Live Now" panel; the
    // dedicated Live Queue page uses /api/queue below for the narrower
    // "who's actually waiting" view with wait-time stats.
    app.get('/api/calls/live', requireAuth, async (req, res) => {
        const { data, error } = await supabase
            .from('call_logs')
            .select('*')
            .in('status', ['ivr_started', 'input_received', 'queued', 'ongoing'])
            .order('created_at', { ascending: false });

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load live calls' });
        }

        res.json({ calls: await attachAgentNames(data.filter(row => !isAgentLegRow(row))) });
    });

    // GET /api/queue — the Live Queue page: this is the design's intended
    // incoming-calls screen, so it needs to show a call from the moment it
    // reaches the IVR, not just once it's actually on hold (status
    // 'queued'). Rows are informational, not individually actionable from
    // the browser — accepting a call happens by an available agent pressing
    // a digit on their phone (see SYSTEM_DESIGN.md), not by clicking a row.
    app.get('/api/queue', requireAuth, async (req, res) => {
        const { data, error } = await supabase
            .from('call_logs')
            .select('*')
            .in('status', ['ivr_started', 'input_received', 'queued'])
            .order('created_at', { ascending: true });

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load queue' });
        }

        const rows = data.map(row => ({
            ...row,
            stage: row.status === 'queued' ? 'Waiting' : 'In Menu',
            waitSeconds: Math.floor((Date.now() - new Date(row.created_at).getTime()) / 1000)
        }));

        // Wait-time stats only count callers actually on hold — someone
        // still navigating the IVR menu hasn't started waiting for an agent
        // yet, so including them would understate how long the queue really is.
        const waits = rows.filter(row => row.stage === 'Waiting').map(row => row.waitSeconds);

        res.json({
            calls: rows,
            stats: {
                inQueue: waits.length,
                avgWaitSeconds: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
                longestWaitSeconds: waits.length ? Math.max(...waits) : 0
            }
        });
    });

    // GET /api/calls/:sessionId — a single call's current state, by session
    // id. Used by the floating dialer to poll for "is the call I just placed
    // still dialing / connected / over" without any push infra. Registered
    // after /api/calls/live and /api/queue above so those literal paths
    // aren't shadowed by this dynamic segment.
    app.get('/api/calls/:sessionId', requireAuth, async (req, res) => {
        const { data, error } = await supabase
            .from('call_logs')
            .select('*')
            .eq('session_id', req.params.sessionId)
            .maybeSingle();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load call' });
        }

        res.json({ call: data ?? null });
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

        if (!['available', 'break', 'offline'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const { data: agent, error: lookupError } = await supabase
            .from('agents')
            .select()
            .eq('email', req.user.email)
            .single();

        if (lookupError || !agent) {
            return res.status(404).json({ error: 'No agent record linked to your account yet' });
        }

        try {
            const { data, error } = await setAgentStatus(agent, status);
            if (error) throw new Error(error.message);
            invalidateAgentCache();
            res.json({ agent: data });
        } catch (err) {
            res.status(502).json({ error: err.message });
        }
    });

    // Name-only list any authenticated user can fetch — enough to populate
    // a ticket's "assign to" dropdown without exposing the full roster
    // (phone numbers, emails) that GET /api/agents (below) is gated on.
    app.get('/api/agents/assignable', requireAuth, async (req, res) => {
        const { data, error } = await supabase.from('agents').select('id, name').order('name');

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load agents' });
        }

        res.json({ agents: data });
    });

    // Drives the active-call status bar and the wrap-up prompt: the
    // logged-in agent's own in-progress call, if any. `call_logs.agent_number`
    // is tagged by /events once Dequeue bridges someone to this agent's
    // phone (see app.js) — this just looks that row up by the agent's own
    // linked phone number.
    app.get('/api/agents/me/active-call', requireAuth, async (req, res) => {
        const { data: agent } = await supabase.from('agents').select('phone, status').eq('email', req.user.email).maybeSingle();

        if (!agent) {
            return res.json({ call: null, agentStatus: null });
        }

        const { data: call } = await supabase
            .from('call_logs')
            .select('*')
            .eq('agent_number', agent.phone)
            .eq('status', 'ongoing')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        res.json({ call: call ?? null, agentStatus: agent.status });
    });

    // Lets the React app register as a real WebRTC softphone (SIP.js) —
    // credentials are provisioned server-side in agent_sip_credentials, kept
    // in its own table (not columns on `agents`) since they're a more
    // sensitive device secret than anything else exposed about an agent.
    app.get('/api/agents/me/sip-credentials', requireAuth, async (req, res) => {
        const { data: agent } = await supabase.from('agents').select('id').eq('email', req.user.email).maybeSingle();

        if (!agent) {
            return res.status(404).json({ error: 'No agent record linked to your account yet' });
        }

        const { data: creds, error } = await supabase
            .from('agent_sip_credentials')
            .select('sip_username, sip_password')
            .eq('agent_id', agent.id)
            .maybeSingle();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load SIP credentials' });
        }

        if (!creds) {
            return res.status(404).json({ error: 'No softphone credentials provisioned for your account yet' });
        }

        res.json({
            username: creds.sip_username,
            password: creds.sip_password,
            domain: process.env.SOFTPHONE_SIP_DOMAIN || 'sip.chumz.online',
            wssUrl: process.env.SOFTPHONE_WSS_URL || 'wss://sip.chumz.online:8089/ws'
        });
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

        if (status !== undefined && !['available', 'on_call', 'ringing', 'break', 'offline'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        if (role !== undefined && !['agent', 'supervisor'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const fieldUpdates = {};
        if (name !== undefined) fieldUpdates.name = name;
        if (phone !== undefined) fieldUpdates.phone = phone;
        if (email !== undefined) fieldUpdates.email = email || null;
        if (role !== undefined) fieldUpdates.role = role;

        let agent;

        if (Object.keys(fieldUpdates).length > 0) {
            const { data, error } = await supabase.from('agents').update(fieldUpdates).eq('id', id).select().single();
            if (error) {
                console.error(error);
                return res.status(500).json({ error: 'Failed to update agent' });
            }
            agent = data;
        } else {
            const { data, error } = await supabase.from('agents').select().eq('id', id).single();
            if (error) {
                console.error(error);
                return res.status(404).json({ error: 'Agent not found' });
            }
            agent = data;
        }

        if (status !== undefined) {
            try {
                const { data, error } = await setAgentStatus(agent, status);
                if (error) throw new Error(error.message);
                agent = data;
            } catch (err) {
                return res.status(502).json({ error: err.message });
            }
        }

        invalidateAgentCache();
        res.json({ agent });
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

    // ── Tickets (Tags & Tickets page) ───────────────────────────────────
    // Any authenticated user can read/create/update tickets — this is
    // day-to-day agent work, not roster/config management.

    // GET /api/tickets?page=1&pageSize=50
    app.get('/api/tickets', requireAuth, async (req, res) => {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
        const rangeStart = (page - 1) * pageSize;

        const { data, error, count } = await supabase
            .from('tickets')
            .select('*, agents(name)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(rangeStart, rangeStart + pageSize - 1);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load tickets' });
        }

        res.json({
            tickets: data.map(t => ({ ...t, assigned_agent_name: t.agents?.name ?? null, agents: undefined })),
            page,
            pageSize,
            total: count ?? 0,
            totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize))
        });
    });

    app.post('/api/tickets', requireAuth, async (req, res) => {
        const { session_id, caller_name, caller_number, tag, priority, status, assigned_agent_id, notes } = req.body;

        if (priority !== undefined && !['Low', 'Medium', 'High', 'Urgent'].includes(priority)) {
            return res.status(400).json({ error: 'Invalid priority' });
        }

        const validStatuses = ['Open', 'Resolved', 'Escalated', 'Follow-up needed', 'No resolution'];
        if (status !== undefined && !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const { data, error } = await supabase
            .from('tickets')
            .insert({
                session_id: session_id || null,
                caller_name: caller_name || null,
                caller_number: caller_number || null,
                tag: tag || null,
                priority: priority || 'Medium',
                status: status || 'Open',
                assigned_agent_id: assigned_agent_id || null,
                notes: notes || null
            })
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to create ticket' });
        }

        res.status(201).json({ ticket: data });
    });

    app.patch('/api/tickets/:id', requireAuth, async (req, res) => {
        const { status, priority, tag, assigned_agent_id, notes } = req.body;

        const validStatuses = ['Open', 'Resolved', 'Escalated', 'Follow-up needed', 'No resolution'];
        if (status !== undefined && !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const updates = {};
        if (status !== undefined) updates.status = status;
        if (priority !== undefined) updates.priority = priority;
        if (tag !== undefined) updates.tag = tag;
        if (assigned_agent_id !== undefined) updates.assigned_agent_id = assigned_agent_id;
        if (notes !== undefined) updates.notes = notes;

        const { data, error } = await supabase.from('tickets').update(updates).eq('id', req.params.id).select().single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to update ticket' });
        }

        res.json({ ticket: data });
    });

    app.get('/api/ticket-tags', requireAuth, async (req, res) => {
        const { data, error } = await supabase.from('ticket_tags').select('name').order('name');

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load tags' });
        }

        res.json({ tags: data.map(t => t.name) });
    });

    app.post('/api/ticket-tags', requireSupervisor, async (req, res) => {
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Tag name is required' });
        }

        const { error } = await supabase.from('ticket_tags').insert({ name: name.trim() });

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to add tag (it may already exist)' });
        }

        res.status(201).json({ ok: true });
    });

    app.delete('/api/ticket-tags/:name', requireSupervisor, async (req, res) => {
        const { error } = await supabase.from('ticket_tags').delete().eq('name', req.params.name);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to remove tag' });
        }

        res.json({ ok: true });
    });

    // ── Call Forwarding (supervisors only) ──────────────────────────────
    // NOTE: this is data management only — it is NOT yet wired into actual
    // call routing. Africa's Talking's Enqueue action has no documented
    // timeout/max-wait parameter, and there's no API to reach into an
    // already-queued call to redirect it, so there's currently no confirmed
    // mechanism to trigger a "no answer" rule automatically. Building that
    // trigger would mean guessing at undocumented behavior — flagged here
    // rather than done. See SYSTEM_DESIGN.md.

    app.get('/api/forwarding-config', requireSupervisor, async (req, res) => {
        const { data, error } = await supabase.from('forwarding_config').select('enabled').eq('id', 1).single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load forwarding config' });
        }

        res.json({ enabled: data.enabled });
    });

    app.patch('/api/forwarding-config', requireSupervisor, async (req, res) => {
        const { enabled } = req.body;

        const { error } = await supabase.from('forwarding_config').update({ enabled: !!enabled }).eq('id', 1);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to update forwarding config' });
        }

        res.json({ ok: true });
    });

    app.get('/api/forwarding-rules', requireSupervisor, async (req, res) => {
        const { data, error } = await supabase.from('forwarding_rules').select('*').order('id');

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load forwarding rules' });
        }

        res.json({ rules: data });
    });

    app.post('/api/forwarding-rules', requireSupervisor, async (req, res) => {
        const { condition, destination } = req.body;

        if (!['no_answer', 'busy', 'always', 'after_hours'].includes(condition)) {
            return res.status(400).json({ error: 'Invalid condition' });
        }

        if (!destination || !destination.trim()) {
            return res.status(400).json({ error: 'Destination is required' });
        }

        const { data, error } = await supabase
            .from('forwarding_rules')
            .insert({ condition, destination: destination.trim() })
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to add rule' });
        }

        res.status(201).json({ rule: data });
    });

    app.delete('/api/forwarding-rules/:id', requireSupervisor, async (req, res) => {
        const { error } = await supabase.from('forwarding_rules').delete().eq('id', req.params.id);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to remove rule' });
        }

        res.json({ ok: true });
    });

    // ── Dashboard: calls by hour ─────────────────────────────────────────

    app.get('/api/calls/by-hour', requireAuth, async (req, res) => {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const { data, error } = await supabase
            .from('call_logs')
            .select('created_at')
            .gte('created_at', startOfDay.toISOString());

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to load call volume' });
        }

        const hourCounts = new Array(24).fill(0);
        data.forEach(row => {
            const hour = new Date(row.created_at).getHours();
            hourCounts[hour]++;
        });

        res.json({
            hours: hourCounts.map((count, hour) => ({ hour, count }))
        });
    });
};
