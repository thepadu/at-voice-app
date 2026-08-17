// Africa's Talking Voice client — used by api.js's setAgentStatus to place
// the outbound call that brings a non-SIP-provisioned agent onto standby.
const AfricasTalking = require('africastalking');

// Built lazily (not at require-time) because the AfricasTalking() constructor
// throws synchronously if apiKey/username are blank — doing that at module
// load would crash the entire server on startup over a feature only
// non-SIP-provisioned agents use, rather than failing just that one call.
let voice = null;
function getVoice() {
    if (!voice) {
        voice = AfricasTalking({
            apiKey: process.env.AT_API_KEY,
            username: process.env.AT_USERNAME
        }).VOICE;
    }
    return voice;
}

const AT_NUMBER = process.env.AT_VOICE_NUMBER;

// Africa's Talking's voice.call() has no per-call callback-URL override —
// every outbound call, once answered, hits the single voice URL configured
// on the AT account (our /voice route). clientRequestId is the only
// documented way to tag a specific outbound call so /voice can tell it
// apart from a plain inbound call — e.g. "agent-standby:42" so /voice knows
// to route agent 42 into the standby loop instead of the customer IVR.
// NOTE: assumed AT echoes this back as `clientRequestId` in the /voice
// callback body — same field name as the request param. Unverified; confirm
// on a live test call.
async function placeCall(phoneE164, clientRequestId) {
    if (!AT_NUMBER) {
        throw new Error('AT_VOICE_NUMBER not set');
    }

    const payload = { callFrom: AT_NUMBER, callTo: [phoneE164] };
    if (clientRequestId) payload.clientRequestId = clientRequestId;

    return getVoice().call(payload);
}

module.exports = { placeCall };
