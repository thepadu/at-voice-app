// A plain module-level flag, not React state — needed by both api.ts (a
// plain function, no hooks) and softphone.tsx, and a flag shared between
// those two in a separate module avoids a circular import between them.
//
// Used to defer apiFetch's hard redirect-to-login on a 401: if a silent
// background call (the heartbeat, an active-call poll, any refetchInterval
// query) 401s while an agent is mid-call, forcing the whole page to
// navigate away would be indistinguishable from "connection lost" to them,
// for a completely unrelated reason. See api.ts for how this is used.
let callInProgress = false;

export function setCallInProgress(value: boolean) {
    callInProgress = value;
}

export function isCallInProgress() {
    return callInProgress;
}
