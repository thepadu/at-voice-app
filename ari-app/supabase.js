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

module.exports = {
    supabase,
    getIvrGreeting,
    getIvrOptions,
    upsertCallLog,
    getAvailableAgentsWithSip,
    setAgentStatus,
    getAgentPhone
};
