const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

// supabase-js instantiates a Realtime client unconditionally (even though
// this app never subscribes to anything), which needs a WebSocket
// implementation — Node 20 has no native `WebSocket` global (that only
// landed in Node 22), so it must be provided explicitly here.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
    realtime: { transport: ws }
});

async function getIvrGreeting() {
    const { data, error } = await supabase.from('ivr_config').select('greeting').eq('id', 1).single();
    if (error) {
        console.error('❌ Failed to load ivr_config:', error.message);
        return 'Welcome to Chumz customer support.';
    }
    return data.greeting;
}

async function getIvrOptions() {
    const { data, error } = await supabase.from('ivr_options').select('*').order('digit', { ascending: true });
    if (error) {
        console.error('❌ Failed to load ivr_options:', error.message);
        return [];
    }
    return data;
}

async function upsertCallLog(row) {
    const { error } = await supabase.from('call_logs').upsert(row, { onConflict: 'session_id' });
    if (error) console.error('❌ Failed to upsert call_logs:', error.message);
}

async function getAvailableAgentsWithSip() {
    const { data, error } = await supabase
        .from('agents')
        .select('id, name, phone, agent_sip_credentials(sip_username)')
        .eq('status', 'available');
    if (error) {
        console.error('❌ Failed to load available agents:', error.message);
        return [];
    }
    return data.filter(a => a.agent_sip_credentials?.sip_username);
}

async function setAgentStatus(agentId, status) {
    const { error } = await supabase.from('agents').update({ status }).eq('id', agentId);
    if (error) console.error('❌ Failed to update agent status:', error.message);
}

async function getAgentPhone(agentId) {
    const { data, error } = await supabase.from('agents').select('phone').eq('id', agentId).maybeSingle();
    if (error) {
        console.error('❌ Failed to load agent phone:', error.message);
        return null;
    }
    return data?.phone ?? null;
}

async function getAgentBySipUsername(sipUsername) {
    if (!sipUsername) return null;
    const { data, error } = await supabase
        .from('agent_sip_credentials')
        .select('agents(id, name, phone)')
        .eq('sip_username', sipUsername)
        .maybeSingle();
    if (error) {
        console.error('❌ Failed to load agent by SIP username:', error.message);
        return null;
    }
    return data?.agents ?? null;
}

// "No agents online" forwarding — reuses the existing 'no_answer' condition
// (the closest semantic fit of the four already in the schema; there's no
// dedicated "nobody logged in" condition) rather than adding a new one.
async function getNoAgentsForwardingDestination() {
    const { data: config } = await supabase.from('forwarding_config').select('enabled').eq('id', 1).maybeSingle();
    if (!config?.enabled) return null;

    const { data: rule } = await supabase
        .from('forwarding_rules')
        .select('destination')
        .eq('condition', 'no_answer')
        .limit(1)
        .maybeSingle();

    return rule?.destination ?? null;
}

// Fails safe: if the table doesn't exist yet (migration not applied) or the
// query errors for any other reason, treat hours as "not enforced" rather
// than risk blocking every inbound call on a config problem.
async function getBusinessHours() {
    const { data, error } = await supabase.from('business_hours').select('*').eq('id', 1).maybeSingle();
    if (error || !data) {
        if (error) console.error('❌ Failed to load business hours:', error.message);
        return { enabled: false };
    }
    return data;
}

// A call that leaves Stasis while still sitting in a pre-answer status was
// never connected to an agent — genuinely missed. The status filter is what
// makes this safe to call for every hung-up channel unconditionally:
// 'ongoing' (already bridged) is deliberately excluded, so this can never
// race with — or overwrite — the real 'completed' outcome that the bridge's
// own cleanup path sets.
async function markMissedIfAbandoned(sessionId) {
    const { error } = await supabase
        .from('call_logs')
        .update({ status: 'failed' })
        .eq('session_id', sessionId)
        .in('status', ['ivr_started', 'input_received', 'queued']);
    if (error) console.error('❌ Failed to mark abandoned call as failed:', error.message);
}

// Runs once at startup. This process's in-memory queue/ring-group state
// always starts empty, so any call_logs row still sitting in a non-terminal
// status is necessarily orphaned from a previous process instance (crash or
// deploy restart) — nothing going forward will ever resolve it otherwise,
// and it would sit in the dashboard's "live" views forever.
async function reconcileStaleCallsOnStartup() {
    const { data, error } = await supabase
        .from('call_logs')
        .update({ status: 'failed' })
        .in('status', ['ivr_started', 'input_received', 'queued', 'ongoing'])
        .select('session_id');
    if (error) {
        console.error('❌ Failed to reconcile stale calls on startup:', error.message);
        return 0;
    }
    return data?.length ?? 0;
}

module.exports = {
    supabase,
    getIvrGreeting,
    getIvrOptions,
    upsertCallLog,
    getAvailableAgentsWithSip,
    setAgentStatus,
    getAgentPhone,
    getAgentBySipUsername,
    getNoAgentsForwardingDestination,
    getBusinessHours,
    markMissedIfAbandoned,
    reconcileStaleCallsOnStartup
};
