require('dotenv').config();
const ari = require('ari-client');
const { normalizePhone } = require('./lib/phone');
const { synthesize } = require('./tts');
const {
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
} = require('./supabase');

const ARI_URL = process.env.ARI_URL || 'http://127.0.0.1:8088';
const ARI_USERNAME = process.env.ARI_USERNAME;
const ARI_PASSWORD = process.env.ARI_PASSWORD;
const APP_NAME = process.env.ARI_APP_NAME || 'chumz-ivr';
const MENU_TIMEOUT_MS = 15000;
const QUEUE_POLL_MS = 3000;
const HOLDING_BRIDGE_NAME = 'support-queue';
// AT's trunk rules explicitly prohibit masking outbound caller ID — every
// agent-placed call must present the same assigned Voice number, regardless
// of which agent's endpoint actually placed it.
const OUTBOUND_CALLER_ID = '0711082161';

// In-memory only — this process is the single, always-running owner of
// real-time call state (unlike the old Express+Supabase model, which had to
// persist everything since any request could hit a different, short-lived
// process). Supabase call_logs/agents are still updated throughout, purely
// for the dashboard's visibility — they are not read back to decide what
// happens next inside this process.
const waitingQueue = []; // { channel, sessionId, joinedAt }
const agentLegBySessionId = new Map(); // agent leg channel id -> { channel: customerChannel, sessionId, agentId }
const ringGroupBySessionId = new Map(); // customer sessionId -> [{ channel: agentChannel, agentId }, ...]
const claimedSessions = new Set(); // customer sessionIds already won by an agent — guards the simultaneous-answer race
const outboundBySessionId = new Map(); // agent-originated sessionId -> { agentChannel, destChannel, bridge, bridged, cleaned, answeredAt }

let client;
let holdingBridge;

// Kenya has a single timezone with no DST (EAT, UTC+3) — not worth a tz
// library dependency for that. active_days is 0=Sunday..6=Saturday.
function isWithinBusinessHours(hours) {
    const nairobiNow = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const day = nairobiNow.getUTCDay();
    if (!hours.active_days.includes(day)) return false;

    const minutesNow = nairobiNow.getUTCHours() * 60 + nairobiNow.getUTCMinutes();
    const [openH, openM] = hours.open_time.split(':').map(Number);
    const [closeH, closeM] = hours.close_time.split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    return minutesNow >= openMinutes && minutesNow < closeMinutes;
}

async function playText(channel, text) {
    const soundName = await synthesize(text);
    const playback = client.Playback();
    // Not awaited — channel.play() resolves once the command is accepted,
    // not once playback finishes; PlaybackFinished is what actually signals
    // completion.
    channel.play({ media: `sound:${soundName}` }, playback);
    return new Promise(resolve => playback.once('PlaybackFinished', resolve));
}

// Returns { promise, cancel } rather than a bare promise — when this loses
// the Promise.race in runIvrMenu (the common case, since a barge-in digit or
// the eventual timeout usually settles after the shorter prompt), the caller
// MUST call cancel() or this leaks a listener on the shared, long-lived
// `client` EventEmitter (and a stray timer) every single menu loop.
function waitForDigitOrTimeout(channelId, timeoutMs) {
    let onDtmf, timer, done = false;
    const promise = new Promise(resolve => {
        onDtmf = (event, evChannel) => {
            if (evChannel.id !== channelId || done) return;
            done = true;
            cleanup();
            resolve(event.digit);
        };
        timer = setTimeout(() => {
            if (done) return;
            done = true;
            cleanup();
            resolve(null);
        }, timeoutMs);
        client.on('ChannelDtmfReceived', onDtmf);
    });
    function cleanup() {
        clearTimeout(timer);
        client.removeListener('ChannelDtmfReceived', onDtmf);
    }
    return { promise, cancel: cleanup };
}

async function getHoldingBridge() {
    if (holdingBridge) {
        try {
            await holdingBridge.get();
            return holdingBridge;
        } catch {
            holdingBridge = null;
        }
    }
    holdingBridge = await client.bridges.create({ type: 'holding', name: HOLDING_BRIDGE_NAME });
    return holdingBridge;
}

async function runIvrMenu(channel, sessionId) {
    const [greeting, options] = await Promise.all([getIvrGreeting(), getIvrOptions()]);

    const menuText = options.length
        ? `${greeting.trim()} ${options.map(o => `Press ${o.digit} for ${o.label}.`).join(' ')}`
        : `${greeting.trim()} Our menu is temporarily unavailable, please try again shortly.`;

    // Play + listen for a barge-in digit concurrently — a caller shouldn't
    // have to wait out the whole prompt before pressing a key. Whichever
    // side loses gets cancelled explicitly — see waitForDigitOrTimeout's
    // comment on why that matters.
    const digitWait = waitForDigitOrTimeout(channel.id, MENU_TIMEOUT_MS);
    const digit = await Promise.race([playText(channel, menuText).then(() => null), digitWait.promise]);
    digitWait.cancel();

    if (!digit) {
        await upsertCallLog({ session_id: sessionId, status: 'input_received' });
        await playText(channel, 'No option was selected.');
        return runIvrMenu(channel, sessionId);
    }

    await upsertCallLog({ session_id: sessionId, option_pressed: digit, status: 'input_received' });

    const option = options.find(o => o.digit === digit);

    if (!option) {
        await playText(channel, 'Invalid input. Please try again.');
        return runIvrMenu(channel, sessionId);
    }

    if (option.action === 'repeat_menu') {
        return runIvrMenu(channel, sessionId);
    }

    if (option.action === 'transfer_agent') {
        if (option.response_message) await playText(channel, option.response_message);

        // Forwarding is a fallback for nobody being logged in at all — an
        // agent or two being busy on other calls is the normal case and
        // should just queue, not forward.
        const availableAgents = await getAvailableAgentsWithSip();
        if (availableAgents.length === 0) {
            const destination = await getNoAgentsForwardingDestination();
            if (destination) {
                console.log(`↪️  ${sessionId}: no agents online, forwarding to ${destination}`);
                // 'forwarded', not 'completed' — no Chumz agent actually took
                // this call, so it belongs in the missed-calls count same as
                // an abandoned one, just with a distinct, honest reason.
                await upsertCallLog({ session_id: sessionId, status: 'forwarded' });
                await channel.setChannelVar({ variable: 'FORWARD_DEST', value: destination });
                return channel.continueInDialplan({ context: 'forward-external', extension: 's', priority: 1 });
            }
        }

        return enterQueue(channel, sessionId);
    }

    // action === 'message'
    if (option.response_message) await playText(channel, option.response_message);
    await upsertCallLog({ session_id: sessionId, status: 'completed' });
    await channel.hangup().catch(() => {});
}

async function enterQueue(channel, sessionId) {
    const bridge = await getHoldingBridge();
    await bridge.addChannel({ channel: channel.id });
    waitingQueue.push({ channel, sessionId, joinedAt: Date.now() });
    await upsertCallLog({ session_id: sessionId, status: 'queued' });
    console.log(`⏳ ${sessionId} entered the hold queue (${waitingQueue.length} waiting)`);
}

// Guards against overlapping runs — setInterval fires every QUEUE_POLL_MS
// regardless of whether the previous call (which can take up to `timeout`
// seconds inside channels.originate) has finished. Without this, two
// overlapping attempts can both grab the same agent, race on their
// setAgentStatus calls, and leave the agent stuck on 'ringing' forever.
let dequeueInFlight = false;

async function tryDequeueNext() {
    if (dequeueInFlight || waitingQueue.length === 0) return;
    dequeueInFlight = true;
    try {
        await dequeueNext();
    } finally {
        dequeueInFlight = false;
    }
}

// Rings every currently-available agent's browser at once — first to
// answer wins (see bridgeAgentLeg's claim check), the rest get hung up and
// put back to 'available' the moment someone else wins.
async function dequeueNext() {
    const agents = await getAvailableAgentsWithSip();
    if (agents.length === 0) return;

    const waiting = waitingQueue.shift();
    console.log(`📲 Ringing ${agents.length} available agent(s) for ${waiting.sessionId}`);

    // The agent's browser should see who's actually calling, not a generic
    // label — pulled straight off the customer's own channel object, still
    // in scope from when they first entered Stasis.
    const customerNumber = normalizePhone(waiting.channel.caller.number) || 'Unknown-Caller';

    const ringGroup = [];

    await Promise.all(
        agents.map(async agent => {
            await setAgentStatus(agent.id, 'ringing');
            try {
                const agentChannel = await client.channels.originate({
                    endpoint: `PJSIP/${agent.agent_sip_credentials.sip_username}`,
                    app: APP_NAME,
                    appArgs: `agent-leg:${agent.id}:${waiting.sessionId}`,
                    // No spaces — ari-client's HTTP layer doesn't URL-encode
                    // query params correctly, and a raw space here silently
                    // produces a malformed request ("Allocation failed")
                    // rather than an encoding error.
                    callerId: customerNumber,
                    timeout: 25
                });
                agentLegBySessionId.set(agentChannel.id, { channel: waiting.channel, sessionId: waiting.sessionId, agentId: agent.id });
                ringGroup.push({ channel: agentChannel, agentId: agent.id });
            } catch (err) {
                console.error(`❌ Failed to ring agent ${agent.id}:`, err.message);
                await setAgentStatus(agent.id, 'available');
            }
        })
    );

    if (ringGroup.length === 0) {
        waitingQueue.unshift(waiting); // nobody could actually be reached — retry next tick
        return;
    }

    ringGroupBySessionId.set(waiting.sessionId, ringGroup);
}

// Hangs up every ringing leg except the winner and reverts their agent
// status — called the instant one agent answers.
async function stopSiblingRings(customerSessionId, winningChannelId) {
    const siblings = ringGroupBySessionId.get(customerSessionId) || [];
    ringGroupBySessionId.delete(customerSessionId);

    await Promise.all(
        siblings
            .filter(sib => sib.channel.id !== winningChannelId)
            .map(async sib => {
                agentLegBySessionId.delete(sib.channel.id);
                await sib.channel.hangup().catch(() => {});
                await setAgentStatus(sib.agentId, 'available');
            })
    );
}

async function bridgeAgentLeg(agentChannel, agentId, customerSessionId) {
    const pending = agentLegBySessionId.get(agentChannel.id);
    agentLegBySessionId.delete(agentChannel.id);
    const customerChannel = pending ? pending.channel : null;

    // No `await` between this check and claimedSessions.add() below — both
    // run synchronously in the same event-loop turn, so two agents
    // answering "simultaneously" still resolve one-at-a-time here. Whoever
    // loses the race sees claimedSessions already holding this session and
    // backs off instead of double-bridging the same customer channel.
    if (!customerChannel || claimedSessions.has(customerSessionId)) {
        await agentChannel.hangup().catch(() => {});
        await setAgentStatus(agentId, 'available');
        return;
    }
    claimedSessions.add(customerSessionId);

    await stopSiblingRings(customerSessionId, agentChannel.id);

    try {
        await agentChannel.answer();
    } catch (err) {
        // The agent rejected, hung up, or the leg failed before actually
        // connecting. Without this, the customer was stranded forever: the
        // claim was never released, so no other agent could ever be bridged
        // to them, they were already dropped from waitingQueue by the
        // dequeue that started this ring, and nothing would retry them.
        console.log(`📵 Agent ${agentId} didn't answer ${customerSessionId}: ${err.message}`);
        claimedSessions.delete(customerSessionId);
        await agentChannel.hangup().catch(() => {});
        await setAgentStatus(agentId, 'available');
        waitingQueue.unshift({ channel: customerChannel, sessionId: customerSessionId, joinedAt: Date.now() });
        return;
    }

    const bridge = await client.bridges.create({ type: 'mixing' });
    await holdingBridge.removeChannel({ channel: customerChannel.id }).catch(() => {});
    await bridge.addChannel({ channel: [customerChannel.id, agentChannel.id] });

    const startedAt = Date.now();
    await setAgentStatus(agentId, 'on_call');
    // Match the same field the rest of the app already keys on — the React
    // app's GET /api/agents/me/active-call looks this row up by agent.phone,
    // not agent id.
    const agentPhone = await getAgentPhone(agentId);
    await upsertCallLog({ session_id: customerSessionId, status: 'ongoing', agent_number: agentPhone });

    console.log(`🔗 Bridged ${customerSessionId} with agent ${agentId}`);

    let cleaned = false;
    const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        claimedSessions.delete(customerSessionId);
        await bridge.destroy().catch(() => {});
        await customerChannel.hangup().catch(() => {});
        await agentChannel.hangup().catch(() => {});
        await setAgentStatus(agentId, 'available');
        await upsertCallLog({
            session_id: customerSessionId,
            status: 'completed',
            duration: Math.round((Date.now() - startedAt) / 1000)
        });
        console.log(`📴 Call ended: ${customerSessionId} <-> agent ${agentId}`);
    };

    customerChannel.once('StasisEnd', cleanup);
    agentChannel.once('StasisEnd', cleanup);
}

// ARI channel names look like "PJSIP/simon-00000123" — the part between the
// slash and the trailing dash is the endpoint name, which doubles as the
// sip_username the agent registered with.
function parseSipUsername(channelName) {
    const match = /^PJSIP\/([^-]+)-/.exec(channelName || '');
    return match ? match[1] : null;
}

// An agent's browser dials out by sending a plain SIP INVITE to Asterisk,
// which the dialplan now routes into this Stasis app instead of a bare
// Dial() — the only way to actually log the call and know which agent placed
// it. The agent leg is answered immediately (so their SIP.js session
// transitions to Established right away) and given a synthesized ring
// indication while the real destination is dialed out separately; the two
// are bridged only once the destination genuinely answers, mirroring the
// same answer-then-bridge sequencing already proven for inbound agent legs.
async function handleOutboundAgentCall(agentChannel, destination) {
    const sessionId = agentChannel.id;
    const calledNumber = normalizePhone(destination);
    const agentInfo = await getAgentBySipUsername(parseSipUsername(agentChannel.name));

    console.log(`📤 Outbound call ${sessionId}: agent ${agentInfo?.name || 'unknown'} -> ${calledNumber}`);

    await upsertCallLog({
        session_id: sessionId,
        caller: calledNumber,
        direction: 'Outbound',
        status: 'dialing',
        agent_number: agentInfo?.phone || null
    });

    await agentChannel.answer();
    await agentChannel.ring().catch(() => {});

    const pending = { agentChannel, destChannel: null, bridge: null, bridged: false, cleaned: false, answeredAt: null };
    outboundBySessionId.set(sessionId, pending);

    agentChannel.once('StasisEnd', () => {
        finishOutboundCall(sessionId, pending.bridged ? 'completed' : 'failed').catch(err =>
            console.error('❌ Error finishing outbound call:', err.message)
        );
    });

    try {
        await client.channels.originate({
            endpoint: `PJSIP/${destination}@at-trunk`,
            app: APP_NAME,
            appArgs: `outbound-dest:${sessionId}`,
            callerId: OUTBOUND_CALLER_ID,
            timeout: 30
        });
    } catch (err) {
        console.error(`❌ Failed to originate outbound call to ${destination}:`, err.message);
        await finishOutboundCall(sessionId, 'failed');
    }
}

// The destination leg enters Stasis as soon as it starts ringing (well
// before answer) — bridging happens only once it actually reaches 'Up', so
// the agent hears the synthesized ring indication (not raw unanswered-bridge
// audio) for as long as the destination is still ringing.
async function bridgeOutboundDest(destChannel, sessionId) {
    const pending = outboundBySessionId.get(sessionId);
    if (!pending) {
        await destChannel.hangup().catch(() => {});
        return;
    }
    pending.destChannel = destChannel;

    const onStateChange = () => {
        if (destChannel.state !== 'Up') return;
        destChannel.removeListener('ChannelStateChange', onStateChange);
        completeOutboundBridge(sessionId).catch(err => console.error('❌ Error bridging outbound call:', err.message));
    };
    destChannel.on('ChannelStateChange', onStateChange);

    destChannel.once('StasisEnd', () => {
        destChannel.removeListener('ChannelStateChange', onStateChange);
        finishOutboundCall(sessionId, pending.bridged ? 'completed' : 'failed').catch(err =>
            console.error('❌ Error finishing outbound call:', err.message)
        );
    });
}

async function completeOutboundBridge(sessionId) {
    const pending = outboundBySessionId.get(sessionId);
    if (!pending || pending.bridged || !pending.destChannel) return;
    pending.bridged = true;
    pending.answeredAt = Date.now();

    const bridge = await client.bridges.create({ type: 'mixing' });
    pending.bridge = bridge;
    await pending.agentChannel.ringStop().catch(() => {});
    await bridge.addChannel({ channel: [pending.agentChannel.id, pending.destChannel.id] });
    await upsertCallLog({ session_id: sessionId, status: 'ongoing' });

    console.log(`🔗 Outbound call bridged: ${sessionId}`);
}

async function finishOutboundCall(sessionId, status) {
    const pending = outboundBySessionId.get(sessionId);
    if (!pending || pending.cleaned) return;
    pending.cleaned = true;
    outboundBySessionId.delete(sessionId);

    await pending.agentChannel.ringStop().catch(() => {});
    if (pending.bridge) await pending.bridge.destroy().catch(() => {});
    await pending.agentChannel.hangup().catch(() => {});
    await pending.destChannel?.hangup().catch(() => {});

    const duration = pending.answeredAt ? Math.round((Date.now() - pending.answeredAt) / 1000) : 0;
    await upsertCallLog({ session_id: sessionId, status, duration });

    console.log(`📴 Outbound call ended: ${sessionId} (${status})`);
}

async function main() {
    client = await ari.connect(ARI_URL, ARI_USERNAME, ARI_PASSWORD);

    client.on('StasisStart', async (event, channel) => {
        const args = event.args || [];

        if (args[0] && args[0].startsWith('agent-leg:')) {
            const [, agentId, customerSessionId] = args[0].split(':');
            bridgeAgentLeg(channel, agentId, customerSessionId).catch(err =>
                console.error('❌ Error bridging agent leg:', err.message)
            );
            return;
        }

        if (args[0] && args[0].startsWith('outbound-agent:')) {
            const destination = args[0].slice('outbound-agent:'.length);
            handleOutboundAgentCall(channel, destination).catch(err =>
                console.error('❌ Error handling outbound call:', err.message)
            );
            return;
        }

        if (args[0] && args[0].startsWith('outbound-dest:')) {
            const sessionId = args[0].slice('outbound-dest:'.length);
            bridgeOutboundDest(channel, sessionId).catch(err =>
                console.error('❌ Error handling outbound destination leg:', err.message)
            );
            return;
        }

        const caller = normalizePhone(channel.caller.number);
        const sessionId = channel.id;
        console.log(`📞 Inbound call ${sessionId} from ${caller}`);

        try {
            await upsertCallLog({ session_id: sessionId, caller, status: 'ivr_started', direction: 'Inbound' });
            await channel.answer();

            const hours = await getBusinessHours();
            if (hours?.enabled && !isWithinBusinessHours(hours)) {
                console.log(`🌙 ${sessionId}: outside business hours, playing after-hours message`);
                await upsertCallLog({ session_id: sessionId, status: 'after_hours' });
                await playText(channel, hours.after_hours_message);
                await channel.hangup().catch(() => {});
                return;
            }

            await runIvrMenu(channel, sessionId);
        } catch (err) {
            console.error(`❌ Error handling call ${sessionId}:`, err.message);
            await channel.hangup().catch(() => {});
        }
    });

    client.on('StasisEnd', async (event, channel) => {
        // Drop from the waiting queue if they hang up before any agent's
        // phone/browser started ringing.
        const idx = waitingQueue.findIndex(w => w.channel.id === channel.id);
        if (idx !== -1) waitingQueue.splice(idx, 1);

        // Customer sessionId === their own channel id — if they hang up
        // while a ring group is still out for them, nothing else would ever
        // stop those other agents' phones/browsers from ringing.
        if (ringGroupBySessionId.has(channel.id)) {
            await stopSiblingRings(channel.id, null);
        }

        // Catch-all for "nobody ever picked this up": a call that leaves
        // Stasis while still sitting in a pre-answer status (never bridged)
        // is a genuinely missed call — the customer either hung up in the
        // menu/queue/while ringing, or gave up entirely. The status filter
        // makes this safe to call unconditionally for every channel
        // (agent legs, outbound legs, bridged/forwarded/after-hours calls
        // all have already moved past these statuses, so this is a no-op
        // for them).
        await markMissedIfAbandoned(channel.id);
    });

    client.on('error', err => console.error('❌ ARI client error:', err.message));

    client.start(APP_NAME);
    setInterval(() => tryDequeueNext().catch(err => console.error('❌ Queue poll error:', err.message)), QUEUE_POLL_MS);

    // This process owns zero in-memory state for anything that was already
    // ivr_started/queued/ongoing before it started — a prior instance's
    // crash or a routine deploy restart both orphan those rows the same
    // way. Left alone they'd sit in call_logs looking "live" forever, since
    // nothing would ever move them to a terminal status again.
    const reconciled = await reconcileStaleCallsOnStartup();
    if (reconciled > 0) console.log(`🧹 Reconciled ${reconciled} stale in-progress call(s) from before this restart`);

    console.log(`✅ ARI app "${APP_NAME}" connected to ${ARI_URL} and listening`);
}

main().catch(err => {
    console.error('❌ Fatal error starting ARI app:', err);
    process.exit(1);
});
