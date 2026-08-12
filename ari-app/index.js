require('dotenv').config();

// A crash here drops every active call on the system, not just one — worth
// containing whatever can be contained. An unhandled rejection (Node 15+
// terminates by default) is logged and the process keeps running, since
// it's almost always scoped to one call's async chain rather than
// corrupting shared state. A genuinely uncaught synchronous exception exits
// deliberately (systemd's Restart=always brings it back up) rather than
// risk continuing to route calls with state integrity no longer guaranteed.
process.on('unhandledRejection', reason => {
    console.error('❌ Unhandled promise rejection:', reason);
});
process.on('uncaughtException', err => {
    console.error('❌ Uncaught exception, exiting:', err);
    process.exit(1);
});

const ari = require('ari-client');
const { normalizePhone } = require('./lib/phone');
const { synthesize } = require('./tts');
const {
    getIvrConfig,
    getIvrOptions,
    upsertCallLog,
    getAvailableAgentsWithSip,
    setAgentStatus,
    getAgentPhone,
    getAgentBySipUsername,
    getNoAgentsForwardingDestination,
    getBusinessHours,
    claimAddPartyRequests,
    setAddPartyStatus,
    markMissedIfAbandoned,
    reconcileStaleCallsOnStartup,
    reconcileStaleAgentsOnStartup,
    reconcileGhostAgents
} = require('./supabase');

const ARI_URL = process.env.ARI_URL || 'http://127.0.0.1:8088';
const ARI_USERNAME = process.env.ARI_USERNAME;
const ARI_PASSWORD = process.env.ARI_PASSWORD;
const APP_NAME = process.env.ARI_APP_NAME || 'chumz-ivr';
const MENU_TIMEOUT_MS = 15000;
const RATING_TIMEOUT_MS = 8000;
const QUEUE_POLL_MS = 3000;
const ADD_PARTY_POLL_MS = 3000;
const GHOST_AGENT_POLL_MS = 30000;
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
const activeBridgeBySessionId = new Map(); // customer sessionId -> the live agent<->customer mixing bridge, for add-a-party
const partyChannelsBySessionId = new Map(); // customer sessionId -> Set of extra channels added (or still dialing) via add-a-party

let client;
let holdingBridge;
let holdingBridgeCreation; // in-flight bridges.create() promise — see getHoldingBridge

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

async function playText(channel, text, voiceOpts) {
    const soundName = await synthesize(text, voiceOpts);
    const playback = client.Playback();
    // Not awaited — channel.play() resolves once the command is accepted,
    // not once playback finishes; PlaybackFinished is what actually signals
    // completion. Still needs a .catch(): if the caller hangs up right as
    // this command reaches Asterisk, the channel is already gone by the
    // time it's processed and this rejects with "Channel not found" — with
    // no await and nothing else referencing this promise, that was an
    // unhandled rejection every time a caller hung up mid-greeting/menu.
    channel.play({ media: `sound:${soundName}` }, playback).catch(() => {});
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

// Two customers can both call this before either has set `holdingBridge` —
// without a lock, each would create its own bridge and only one would ever
// be remembered, orphaning whichever customer ended up in the other one.
// Concurrent callers now await the same in-flight creation instead of racing.
async function getHoldingBridge() {
    if (holdingBridge) {
        try {
            await holdingBridge.get();
            return holdingBridge;
        } catch {
            holdingBridge = null;
        }
    }
    if (!holdingBridgeCreation) {
        holdingBridgeCreation = client.bridges
            .create({ type: 'holding', name: HOLDING_BRIDGE_NAME })
            .finally(() => {
                holdingBridgeCreation = null;
            });
    }
    holdingBridge = await holdingBridgeCreation;
    return holdingBridge;
}

async function runIvrMenu(channel, sessionId) {
    const [ivrConfig, options] = await Promise.all([getIvrConfig(), getIvrOptions()]);
    const { greeting, ttsVoice, ttsSpeedScale } = ivrConfig;
    const voiceOpts = { voiceKey: ttsVoice, speedScale: ttsSpeedScale };

    const menuText = options.length
        ? `${greeting.trim()} ${options.map(o => `Press ${o.digit} for ${o.label}.`).join(' ')}`
        : `${greeting.trim()} Our menu is temporarily unavailable, please try again shortly.`;

    // Play + listen for a barge-in digit concurrently — a caller shouldn't
    // have to wait out the whole prompt before pressing a key. Whichever
    // side loses gets cancelled explicitly — see waitForDigitOrTimeout's
    // comment on why that matters.
    const digitWait = waitForDigitOrTimeout(channel.id, MENU_TIMEOUT_MS);
    const digit = await Promise.race([playText(channel, menuText, voiceOpts).then(() => null), digitWait.promise]);
    digitWait.cancel();

    if (!digit) {
        await upsertCallLog({ session_id: sessionId, status: 'input_received' });
        await playText(channel, 'No option was selected.', voiceOpts);
        return runIvrMenu(channel, sessionId);
    }

    await upsertCallLog({ session_id: sessionId, option_pressed: digit, status: 'input_received' });

    const option = options.find(o => o.digit === digit);

    if (!option) {
        await playText(channel, 'Invalid input. Please try again.', voiceOpts);
        return runIvrMenu(channel, sessionId);
    }

    if (option.action === 'repeat_menu') {
        return runIvrMenu(channel, sessionId);
    }

    if (option.action === 'transfer_agent') {
        if (option.response_message) await playText(channel, option.response_message, voiceOpts);

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
    if (option.response_message) await playText(channel, option.response_message, voiceOpts);
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
    // Registered before origination starts, not after every originate()
    // resolves — the global StasisEnd handler below looks up this map to
    // stop sibling rings the instant the customer hangs up, and origination
    // can take a couple seconds across several agents. Populating it only
    // at the end left a customer hangup during that window with nothing to
    // find, so already-ringing agents kept ringing for someone who'd left.
    ringGroupBySessionId.set(waiting.sessionId, ringGroup);

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
        ringGroupBySessionId.delete(waiting.sessionId);
        waitingQueue.unshift(waiting); // nobody could actually be reached — retry next tick
    }
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

    // Catches the customer hanging up in the narrow window while we're still
    // awaiting the agent's answer() below — the real cleanup listeners aren't
    // attached until after answer() succeeds, so without this a hangup here
    // would only ever surface later as a failed bridge.addChannel once the
    // agent's leg tries to connect to an already-gone customer channel.
    let customerHungUpEarly = false;
    const onEarlyCustomerHangup = () => {
        customerHungUpEarly = true;
    };
    customerChannel.once('StasisEnd', onEarlyCustomerHangup);

    try {
        await agentChannel.answer();
    } catch (err) {
        // The agent rejected, hung up, or the leg failed before actually
        // connecting. Without this, the customer was stranded forever: the
        // claim was never released, so no other agent could ever be bridged
        // to them, they were already dropped from waitingQueue by the
        // dequeue that started this ring, and nothing would retry them.
        console.log(`📵 Agent ${agentId} didn't answer ${customerSessionId}: ${err.message}`);
        customerChannel.removeListener('StasisEnd', onEarlyCustomerHangup);
        claimedSessions.delete(customerSessionId);
        await agentChannel.hangup().catch(() => {});
        await setAgentStatus(agentId, 'available');
        if (!customerHungUpEarly) {
            waitingQueue.unshift({ channel: customerChannel, sessionId: customerSessionId, joinedAt: Date.now() });
        }
        return;
    }

    customerChannel.removeListener('StasisEnd', onEarlyCustomerHangup);
    if (customerHungUpEarly) {
        console.log(`📵 Customer hung up before agent ${agentId} finished answering ${customerSessionId}`);
        claimedSessions.delete(customerSessionId);
        await agentChannel.hangup().catch(() => {});
        await setAgentStatus(agentId, 'available');
        return;
    }

    // Registered right after answer() succeeds — before the bridge-setup
    // sequence below, which has several awaits (bridge create, remove from
    // holding, add channels, DB writes). Attaching these listeners only
    // after all of that finished meant a hangup during that window fired
    // StasisEnd before anything was listening for it: standard EventEmitter
    // semantics, an event that fires before you subscribe is simply missed.
    // The agent would be left claimed, on_call, and bridged to a channel
    // that no longer existed, with nothing to ever clean it up.
    // Split from a single shared cleanup() into two directions: only an
    // agent-initiated hangup can plausibly route the customer into a rating
    // prompt afterward (bridge.destroy() doesn't hang up member channels —
    // that's exactly why the explicit agentChannel.hangup() below is still
    // needed — so the customer leg is left live and controllable). A
    // customer-initiated hangup means there's nothing left to prompt.
    let cleaned = false;
    const state = { bridge: null, startedAt: null };
    const teardown = async finalStatus => {
        if (cleaned) return;
        cleaned = true;
        claimedSessions.delete(customerSessionId);
        activeBridgeBySessionId.delete(customerSessionId);
        // Every party added via add-a-party, including one still ringing and
        // not yet actually in the bridge — otherwise a channel mid-dial when
        // the original call ends is never hung up here, only whenever
        // Asterisk's own dial timeout eventually gives up on it.
        const partyChannels = partyChannelsBySessionId.get(customerSessionId);
        partyChannelsBySessionId.delete(customerSessionId);
        if (state.bridge) await state.bridge.destroy().catch(() => {});
        await agentChannel.hangup().catch(() => {});
        if (partyChannels) await Promise.all([...partyChannels].map(ch => ch.hangup().catch(() => {})));
        await setAgentStatus(agentId, 'available');
        await upsertCallLog({
            session_id: customerSessionId,
            status: finalStatus,
            duration: state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : 0
        });
        console.log(`📴 Call ended: ${customerSessionId} <-> agent ${agentId} (${finalStatus})`);
    };

    customerChannel.once('StasisEnd', async () => {
        await teardown('completed');
        await customerChannel.hangup().catch(() => {});
    });

    agentChannel.once('StasisEnd', async () => {
        await teardown('completed');
        const { ratingEnabled, ttsVoice, ttsSpeedScale } = await getIvrConfig();
        if (ratingEnabled) {
            await runRatingIvr(customerChannel, customerSessionId, { voiceKey: ttsVoice, speedScale: ttsSpeedScale }).catch(err =>
                console.error(`❌ Rating IVR error for ${customerSessionId}:`, err.message)
            );
        } else {
            await customerChannel.hangup().catch(() => {});
        }
    });

    try {
        const bridge = await client.bridges.create({ type: 'mixing' });
        state.bridge = bridge;
        activeBridgeBySessionId.set(customerSessionId, bridge);
        await holdingBridge.removeChannel({ channel: customerChannel.id }).catch(() => {});
        await bridge.addChannel({ channel: [customerChannel.id, agentChannel.id] });

        state.startedAt = Date.now();
        await setAgentStatus(agentId, 'on_call');
        // Match the same field the rest of the app already keys on — the
        // React app's GET /api/agents/me/active-call looks this row up by
        // agent.phone, not agent id.
        const agentPhone = await getAgentPhone(agentId);
        await upsertCallLog({ session_id: customerSessionId, status: 'ongoing', agent_number: agentPhone });

        console.log(`🔗 Bridged ${customerSessionId} with agent ${agentId}`);
    } catch (err) {
        // Previously unhandled — this rejection propagated all the way to
        // the generic StasisStart catch, leaving the claim held forever,
        // the agent stuck (never reverted to available), and no StasisEnd
        // listener state to fall back on either. Now it's exactly one of
        // several ways teardown() can be reached, all idempotent. The bridge
        // never really formed, so this always takes the plain-hangup path,
        // never the rating one.
        console.error(`❌ Error bridging agent ${agentId} to ${customerSessionId}:`, err.message);
        await teardown('failed');
        await customerChannel.hangup().catch(() => {});
    }
}

// Only reached from bridgeAgentLeg's agent-hung-up path, on a customer
// channel that's still live but no longer bridged to anyone. Reuses the
// exact "play a prompt, race it against a digit-or-timeout" idiom already
// proven in runIvrMenu. A digit outside 1-5, a timeout, or the customer
// hanging up mid-prompt all just skip the rating write and hang up —
// nothing here can leave the channel stuck.
async function runRatingIvr(customerChannel, sessionId, voiceOpts) {
    console.log(`⭐ ${sessionId}: playing rating prompt`);
    let customerGone = false;
    const onGone = () => {
        customerGone = true;
    };
    customerChannel.once('StasisEnd', onGone);

    const digitWait = waitForDigitOrTimeout(customerChannel.id, RATING_TIMEOUT_MS);
    const digit = await Promise.race([
        playText(customerChannel, 'Please rate this call from 1 to 5, with 5 being excellent.', voiceOpts)
            .then(() => null)
            .catch(() => null),
        digitWait.promise
    ]);
    digitWait.cancel();
    customerChannel.removeListener('StasisEnd', onGone);

    if (!customerGone && digit && /^[1-5]$/.test(digit)) {
        await upsertCallLog({ session_id: sessionId, rating: Number(digit) });
        console.log(`⭐ ${sessionId} rated ${digit}/5`);
    } else {
        console.log(`⭐ ${sessionId}: no rating captured (customerGone=${customerGone}, digit=${digit ?? 'none'})`);
    }

    await customerChannel.hangup().catch(() => {});
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
// transitions to Established right away) while the real destination is
// dialed out separately; the two are bridged only once the destination
// genuinely answers, mirroring the same answer-then-bridge sequencing
// already proven for inbound agent legs. A ring() indication gives the
// agent real ringback audio for however long the destination actually
// takes to pick up, instead of silence.
async function handleOutboundAgentCall(agentChannel, destination) {
    const sessionId = agentChannel.id;
    const calledNumber = normalizePhone(destination);

    try {
        await agentChannel.answer();
    } catch (err) {
        console.error(`❌ Failed to answer outbound agent leg ${sessionId}:`, err.message);
        await agentChannel.hangup().catch(() => {});
        return;
    }

    // Registered immediately after answer() succeeds, before any further
    // awaits — an agent hanging up during the ring() call below would
    // otherwise fire StasisEnd before anything is listening for it, leaving
    // this session's pending state (and the real PSTN dial further down)
    // to run to completion for an agent who already hung up.
    const pending = {
        agentChannel,
        agentId: null,
        destChannel: null,
        bridge: null,
        bridged: false,
        cleaned: false,
        answeredAt: null
    };
    outboundBySessionId.set(sessionId, pending);

    agentChannel.once('StasisEnd', () => {
        finishOutboundCall(sessionId, pending.bridged ? 'completed' : 'failed').catch(err =>
            console.error('❌ Error finishing outbound call:', err.message)
        );
    });

    // Gives the agent audible ringback while the destination is actually
    // ringing (confirmed via live SIP trace: the destination can genuinely
    // ring for 10+ real seconds before pickup) — without this the agent
    // hears silence the whole time, indistinguishable from "nothing is
    // happening". Stopped in completeOutboundBridge once real audio takes
    // over, or in finishOutboundCall if the call ends before that.
    await agentChannel.ring().catch(() => {});

    if (pending.cleaned) return; // agent already hung up — don't dial the real destination for nothing

    // The destination should start dialing as fast as possible — measured
    // live, the agent lookup + call log write below took ~665ms combined
    // (two sequential Supabase round trips), all of it previously spent
    // *before* originate() was even called. Neither is needed to place the
    // call itself, only to log/attribute it, so they now run concurrently
    // with origination instead of blocking it. Safe ordering-wise: the
    // initial 'dialing' row lands well before any real PSTN answer could
    // possibly arrive (that alone takes several seconds), so there's no
    // realistic risk of it overwriting completeOutboundBridge's later
    // 'ongoing' write.
    const logPromise = (async () => {
        const agentInfo = await getAgentBySipUsername(parseSipUsername(agentChannel.name));
        pending.agentId = agentInfo?.id ?? null;
        console.log(`📤 Outbound call ${sessionId}: agent ${agentInfo?.name || 'unknown'} -> ${calledNumber}`);
        await upsertCallLog({
            session_id: sessionId,
            caller: calledNumber,
            direction: 'Outbound',
            status: 'dialing',
            agent_number: agentInfo?.phone || null
        });
    })();

    const originatePromise = client.channels
        .originate({
            endpoint: `PJSIP/${destination}@at-trunk`,
            app: APP_NAME,
            appArgs: `outbound-dest:${sessionId}`,
            callerId: OUTBOUND_CALLER_ID,
            timeout: 30
        })
        .catch(async err => {
            console.error(`❌ Failed to originate outbound call to ${destination}:`, err.message);
            // Wait for the concurrent 'dialing' write to land first (best
            // effort — ignore if it itself failed) so this 'failed' write is
            // guaranteed to be the last one in, not overwritten by a
            // slower-to-land 'dialing' upsert racing in after it.
            await logPromise.catch(() => {});
            return finishOutboundCall(sessionId, 'failed');
        });

    await Promise.all([logPromise, originatePromise]);
}

// The destination leg USUALLY enters Stasis while still ringing, well
// before answer — but confirmed live (see the state-staleness bug this
// replaced) that a quickly-answered call on this trunk can already be 'Up'
// by the time StasisStart fires and we get control of it. That means
// waiting on a *future* ChannelStateChange to 'Up' is not sufficient by
// itself — there may never be one, since the channel is already there.
// Checked both ways: immediately against the freshly-constructed channel
// object's own state (accurate at this exact moment, unlike stashing this
// same reference and re-reading .state off it after later events — that
// staleness is what broke this originally), and via the listener for the
// case where it's still genuinely ringing.
async function bridgeOutboundDest(destChannel, sessionId) {
    const pending = outboundBySessionId.get(sessionId);
    if (!pending) {
        await destChannel.hangup().catch(() => {});
        return;
    }
    pending.destChannel = destChannel;

    const onStateChange = (event, updatedChannel) => {
        if (updatedChannel.state !== 'Up') return;
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

    if (destChannel.state === 'Up') {
        destChannel.removeListener('ChannelStateChange', onStateChange);
        completeOutboundBridge(sessionId).catch(err => console.error('❌ Error bridging outbound call (already up):', err.message));
    }
}

async function completeOutboundBridge(sessionId) {
    const pending = outboundBySessionId.get(sessionId);
    // `bridging` guards against re-entry while this is still in flight
    // (async, so a second ChannelStateChange event could otherwise start a
    // second concurrent attempt); `bridged` is only set true once the
    // bridge has actually, successfully formed — previously it was set
    // eagerly up front, so a failure in bridges.create()/addChannel() below
    // would still leave the call logged as 'completed' rather than
    // 'failed' when it later ended (finishOutboundCall branches on exactly
    // this flag), and the agent's status would never actually flip to
    // on_call at all since that line was never reached.
    if (!pending || pending.bridging || pending.bridged || !pending.destChannel) return;
    pending.bridging = true;

    try {
        await pending.agentChannel.ringStop().catch(() => {});
        const bridge = await client.bridges.create({ type: 'mixing' });
        pending.bridge = bridge;
        await bridge.addChannel({ channel: [pending.agentChannel.id, pending.destChannel.id] });
        await upsertCallLog({ session_id: sessionId, status: 'ongoing' });

        pending.bridged = true;
        pending.answeredAt = Date.now();

        // Without this, the roster and ring-all both kept seeing the agent
        // as 'available' for the entire duration of an outbound call — a
        // new customer could be routed straight to someone already busy.
        if (pending.agentId) await setAgentStatus(pending.agentId, 'on_call');

        console.log(`🔗 Outbound call bridged: ${sessionId}`);
    } catch (err) {
        console.error(`❌ Failed to complete outbound bridge for ${sessionId}:`, err.message);
        await finishOutboundCall(sessionId, 'failed');
    }
}

async function finishOutboundCall(sessionId, status) {
    const pending = outboundBySessionId.get(sessionId);
    if (!pending || pending.cleaned) return;
    pending.cleaned = true;
    outboundBySessionId.delete(sessionId);

    if (pending.bridge) await pending.bridge.destroy().catch(() => {});
    await pending.agentChannel.hangup().catch(() => {});
    await pending.destChannel?.hangup().catch(() => {});

    // Only revert if this call actually flipped them to on_call in the
    // first place (completeOutboundBridge) — a call that never bridged
    // never touched agent status, and forcing 'available' here could
    // stomp on an unrelated concurrent state change (e.g. mid-ring for a
    // different, incoming call).
    if (pending.agentId && pending.bridged) await setAgentStatus(pending.agentId, 'available');

    const duration = pending.answeredAt ? Math.round((Date.now() - pending.answeredAt) / 1000) : 0;
    await upsertCallLog({ session_id: sessionId, status, duration });

    console.log(`📴 Outbound call ended: ${sessionId} (${status})`);
}

// Blind-add-a-party MVP: at-voice-app has no direct line into a live call —
// this process is the only thing that can touch a real bridge — so a
// supervisor/agent request lands as two columns on the call's own
// call_logs row (set by POST /api/calls/active/add-party) and this poll
// picks it up. Same guarded-interval shape as tryDequeueNext.
let addPartyPollInFlight = false;

async function tryAddPartyPoll() {
    if (addPartyPollInFlight) return;
    addPartyPollInFlight = true;
    try {
        const requests = await claimAddPartyRequests();
        await Promise.all(requests.map(req => originateAddPartyLeg(req.session_id, req.add_party_destination)));
    } finally {
        addPartyPollInFlight = false;
    }
}

// Dials the new party exactly like handleOutboundAgentCall dials its real
// destination leg — same trunk, same endpoint shape — but this leg is never
// bridged to a fresh agent channel; bridgeAddPartyDest below merges it
// straight into the existing agent<->customer bridge once it answers.
async function originateAddPartyLeg(customerSessionId, destination) {
    if (!activeBridgeBySessionId.has(customerSessionId)) {
        // The original call already ended (or was never actually bridged)
        // by the time this request was claimed — nothing to add to.
        await setAddPartyStatus(customerSessionId, 'failed');
        return;
    }

    try {
        await client.channels.originate({
            endpoint: `PJSIP/${destination}@at-trunk`,
            app: APP_NAME,
            appArgs: `add-party-dest:${customerSessionId}`,
            callerId: OUTBOUND_CALLER_ID,
            timeout: 30
        });
    } catch (err) {
        console.error(`❌ Failed to originate add-party leg to ${destination} for ${customerSessionId}:`, err.message);
        await setAddPartyStatus(customerSessionId, 'failed');
    }
}

// The new party's channel enters Stasis the same way an outbound-dest leg
// does (see bridgeOutboundDest) — it may already be 'Up' by the time we get
// control, or still genuinely ringing. Tracked in partyChannelsBySessionId
// from the moment it enters Stasis (not just once answered) so a hangup —
// either this channel's own or the original call ending first — can never
// orphan it mid-dial.
async function bridgeAddPartyDest(destChannel, customerSessionId) {
    const partyChannels = partyChannelsBySessionId.get(customerSessionId) || new Set();
    partyChannels.add(destChannel);
    partyChannelsBySessionId.set(customerSessionId, partyChannels);

    let bridged = false;
    const onStateChange = (event, updatedChannel) => {
        if (updatedChannel.state !== 'Up') return;
        destChannel.removeListener('ChannelStateChange', onStateChange);
        bridged = true;
        completeAddParty(destChannel, customerSessionId).catch(err =>
            console.error(`❌ Error completing add-party for ${customerSessionId}:`, err.message)
        );
    };
    destChannel.on('ChannelStateChange', onStateChange);

    destChannel.once('StasisEnd', () => {
        destChannel.removeListener('ChannelStateChange', onStateChange);
        partyChannels.delete(destChannel);
        // If the original call already ended, this StasisEnd is just the
        // bridge's own teardown hanging this channel up too — leave
        // add_party_status alone (teardown doesn't touch it, and the row
        // itself is about to go to a terminal status anyway). Only report
        // in when the original call is still live: 'failed' if it never
        // got bridged (no answer / dial error), 'left' if it did and then
        // hung up on its own.
        if (activeBridgeBySessionId.has(customerSessionId)) {
            setAddPartyStatus(customerSessionId, bridged ? 'left' : 'failed').catch(() => {});
        }
    });

    if (destChannel.state === 'Up') {
        destChannel.removeListener('ChannelStateChange', onStateChange);
        bridged = true;
        await completeAddParty(destChannel, customerSessionId);
    }
}

async function completeAddParty(destChannel, customerSessionId) {
    const bridge = activeBridgeBySessionId.get(customerSessionId);
    if (!bridge) {
        // Original call ended while this leg was still ringing.
        await destChannel.hangup().catch(() => {});
        return;
    }

    await bridge.addChannel({ channel: destChannel.id });
    await setAddPartyStatus(customerSessionId, 'connected');
    console.log(`➕ Added party to call ${customerSessionId}`);
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

        if (args[0] && args[0].startsWith('add-party-dest:')) {
            const customerSessionId = args[0].slice('add-party-dest:'.length);
            bridgeAddPartyDest(channel, customerSessionId).catch(err =>
                console.error('❌ Error handling add-party destination leg:', err.message)
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
                const { ttsVoice, ttsSpeedScale } = await getIvrConfig();
                await playText(channel, hours.after_hours_message, { voiceKey: ttsVoice, speedScale: ttsSpeedScale });
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
    setInterval(() => tryAddPartyPoll().catch(err => console.error('❌ Add-party poll error:', err.message)), ADD_PARTY_POLL_MS);

    // "Ghost agents" — status says available/ringing but the browser
    // heartbeat behind it has gone stale (or never existed at all, e.g. a
    // row seeded/provisioned with status='available' that nobody ever
    // actually logged into) — see reconcileGhostAgents for the full
    // rationale. Checked continuously, not just at startup, since most
    // ghosts are created by a tab dying mid-session, not by a restart.
    setInterval(
        () =>
            reconcileGhostAgents()
                .then(count => {
                    if (count > 0) console.log(`👻 Reconciled ${count} ghost agent(s) back to offline`);
                })
                .catch(err => console.error('❌ Ghost agent poll error:', err.message)),
        GHOST_AGENT_POLL_MS
    );

    // This process owns zero in-memory state for anything that was already
    // ivr_started/queued/ongoing before it started — a prior instance's
    // crash or a routine deploy restart both orphan those rows the same
    // way. Left alone they'd sit in call_logs looking "live" forever, since
    // nothing would ever move them to a terminal status again.
    const reconciled = await reconcileStaleCallsOnStartup();
    if (reconciled > 0) console.log(`🧹 Reconciled ${reconciled} stale in-progress call(s) from before this restart`);

    const staleAgentsReconciled = await reconcileStaleAgentsOnStartup();
    if (staleAgentsReconciled > 0)
        console.log(`🧹 Reconciled ${staleAgentsReconciled} agent(s) stuck on-call from before this restart`);

    const ghostsReconciled = await reconcileGhostAgents();
    if (ghostsReconciled > 0) console.log(`👻 Reconciled ${ghostsReconciled} ghost agent(s) back to offline on startup`);

    console.log(`✅ ARI app "${APP_NAME}" connected to ${ARI_URL} and listening`);
}

main().catch(err => {
    console.error('❌ Fatal error starting ARI app:', err);
    process.exit(1);
});
