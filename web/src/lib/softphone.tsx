import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { UserAgent, Registerer, RegistererState, Inviter, SessionState } from 'sip.js';
import type { Invitation, Session } from 'sip.js';
import { apiFetch } from './api';
import { useAuth } from './auth';
import { useToast } from './toast';

type RegistrationState = 'unregistered' | 'registering' | 'registered' | 'failed';

type IncomingCall = { session: Invitation; callerNumber: string };
type OutgoingCall = { session: Inviter; remoteNumber: string };
type ActiveCall = { session: Session; remoteNumber: string; muted: boolean; held: boolean; startedAt: number };

type SoftphoneContextValue = {
    registrationState: RegistrationState;
    incomingCall: IncomingCall | null;
    outgoingCall: OutgoingCall | null;
    activeCall: ActiveCall | null;
    answer: () => Promise<void>;
    reject: () => void;
    hangup: () => void;
    cancelOutgoingCall: () => void;
    toggleMute: () => void;
    toggleHold: () => void;
    placeCall: (destinationE164: string) => Promise<void>;
    audioOutputSupported: boolean;
    speakerOn: boolean;
    toggleSpeaker: () => Promise<void>;
    micPermissionDenied: boolean;
};

const SoftphoneContext = createContext<SoftphoneContextValue>({
    registrationState: 'unregistered',
    incomingCall: null,
    outgoingCall: null,
    activeCall: null,
    answer: async () => {},
    reject: () => {},
    hangup: () => {},
    cancelOutgoingCall: () => {},
    toggleMute: () => {},
    toggleHold: () => {},
    placeCall: async () => {},
    audioOutputSupported: false,
    speakerOn: false,
    toggleSpeaker: async () => {},
    micPermissionDenied: false
});

// setSinkId() is a real method on HTMLMediaElement in Chrome/Edge but isn't
// in the standard lib.dom typings yet (Safari/Firefox don't implement it at
// all) — narrowed locally rather than widening the global HTMLAudioElement type.
type SinkableAudioElement = HTMLAudioElement & {
    setSinkId?: (sinkId: string) => Promise<void>;
};

// Attaches whatever audio tracks the peer connection is receiving to a
// hidden <audio> element — SIP.js doesn't do this for you, it just hands you
// the underlying RTCPeerConnection.
function attachRemoteAudio(session: Session, audioEl: HTMLAudioElement) {
    const pc = (session.sessionDescriptionHandler as unknown as { peerConnection: RTCPeerConnection })
        ?.peerConnection;
    if (!pc) return;
    const remoteStream = new MediaStream();
    pc.getReceivers().forEach(receiver => {
        if (receiver.track) remoteStream.addTrack(receiver.track);
    });
    audioEl.srcObject = remoteStream;
    audioEl.play().catch(() => {});
}

function getAudioSender(session: Session) {
    const pc = (session.sessionDescriptionHandler as unknown as { peerConnection: RTCPeerConnection })
        ?.peerConnection;
    return pc?.getSenders().find(s => s.track?.kind === 'audio') ?? null;
}

export function SoftphoneProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const showToast = useToast();
    const userAgentRef = useRef<UserAgent | null>(null);
    const registererRef = useRef<Registerer | null>(null);
    const domainRef = useRef<string>('sip.chumz.online');
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

    const [registrationState, setRegistrationState] = useState<RegistrationState>('unregistered');
    const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
    const [outgoingCall, setOutgoingCall] = useState<OutgoingCall | null>(null);
    const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
    const [speakerOn, setSpeakerOn] = useState(false);
    const [micPermissionDenied, setMicPermissionDenied] = useState(false);
    const hasSetAvailableRef = useRef(false);
    const hasRequestedMicRef = useRef(false);

    const audioOutputSupported = typeof (window.HTMLMediaElement?.prototype as SinkableAudioElement)?.setSinkId === 'function';

    useEffect(() => {
        if (!remoteAudioRef.current) {
            const el = document.createElement('audio');
            el.autoplay = true;
            document.body.appendChild(el);
            remoteAudioRef.current = el;
        }
        return () => {
            remoteAudioRef.current?.remove();
            remoteAudioRef.current = null;
        };
    }, []);

    const handleSessionEstablished = useCallback((session: Session, remoteNumber: string) => {
        if (remoteAudioRef.current) attachRemoteAudio(session, remoteAudioRef.current);
        setActiveCall({ session, remoteNumber, muted: false, held: false, startedAt: Date.now() });
    }, []);

    const handleSessionTerminated = useCallback(() => {
        // The <audio> element persists across calls (it's created once per
        // softphone session, not per call) — if a call ends while still on
        // hold, its .muted flag would otherwise stay true forever, leaving
        // the *next* call silent with no error or visual cue. Same reasoning
        // for the output sink: if a call ends while on speaker, the next
        // call would silently keep playing through it even though the UI
        // (reset below) shows the earpiece icon again.
        if (remoteAudioRef.current) {
            remoteAudioRef.current.muted = false;
            (remoteAudioRef.current as SinkableAudioElement).setSinkId?.('').catch(() => {});
        }
        setActiveCall(null);
        setSpeakerOn(false);
    }, []);

    const wireSessionStateChange = useCallback(
        (session: Session, remoteNumber: string) => {
            session.stateChange.addListener(state => {
                if (state === SessionState.Established) handleSessionEstablished(session, remoteNumber);
                else if (state === SessionState.Terminated) handleSessionTerminated();
            });
        },
        [handleSessionEstablished, handleSessionTerminated]
    );

    useEffect(() => {
        if (!user?.agentId) return;

        let cancelled = false;

        (async () => {
            let creds;
            try {
                creds = await apiFetch('/api/agents/me/sip-credentials');
            } catch (err) {
                // A 404 here is expected for an agent with no softphone
                // credentials provisioned yet — anything else (401, 500,
                // network failure) is a real problem worth seeing rather
                // than silently leaving registrationState stuck at
                // 'unregistered' with no clue why.
                console.error('[softphone] failed to fetch SIP credentials:', err);
                setRegistrationState('failed');
                return;
            }
            if (cancelled) return;

            console.log(`[softphone] got credentials for ${creds.username}@${creds.domain}, connecting to ${creds.wssUrl}`);

            domainRef.current = creds.domain;
            const uri = UserAgent.makeURI(`sip:${creds.username}@${creds.domain}`);
            if (!uri) {
                console.error('[softphone] UserAgent.makeURI returned null for', creds.username, creds.domain);
                setRegistrationState('failed');
                return;
            }

            let everConnected = false;

            // Shared by the initial registration and every reconnect attempt
            // below, so a re-register after a dropped connection gets the
            // exact same failure handling as the first one — previously the
            // reconnect path fired-and-forgot register() with no onReject
            // and no catch, so a re-register that actually failed left the
            // agent silently unreachable with a stale "reconnected" toast as
            // the last thing they saw.
            const registerNow = async () => {
                if (!registererRef.current) return;
                try {
                    await registererRef.current.register({
                        requestDelegate: {
                            onReject: () => {
                                setRegistrationState('failed');
                                showToast('Softphone registration failed — you won’t receive browser calls', 'error');
                            }
                        }
                    });
                } catch (err) {
                    console.error('[softphone] registration threw:', err);
                    if (!cancelled) {
                        setRegistrationState('failed');
                        showToast('Softphone registration failed — you won’t receive browser calls', 'error');
                    }
                }
            };

            const userAgent = new UserAgent({
                uri,
                // keepAliveInterval pings the WebSocket every 30s so idle
                // periods (an agent's tab sitting untouched for hours)
                // don't get silently dropped by a proxy/NAT timing out an
                // apparently-inactive connection — this was the root cause
                // of "softphone not registered" after a while idle, with no
                // error and no automatic recovery. reconnectionAttempts is
                // 0 by default (no retry at all) — Infinity plus onConnect
                // re-registering below is what actually recovers a dropped
                // connection instead of leaving the agent silently
                // unreachable until they refresh the page.
                transportOptions: { server: creds.wssUrl, keepAliveInterval: 30 },
                reconnectionAttempts: Infinity,
                reconnectionDelay: 4,
                authorizationUsername: creds.username,
                authorizationPassword: creds.password,
                // Without this, the browser's own ICE gathering had zero
                // NAT-traversal help — not even STUN — and relied entirely
                // on a direct host-candidate path succeeding. Any agent on
                // a symmetric NAT or a restrictive mobile/corporate network
                // would silently get one-way or no audio with nothing to
                // fall back to. The TURN server also answers plain STUN
                // binding requests, so one entry covers both.
                sessionDescriptionHandlerFactoryOptions: {
                    peerConnectionConfiguration: {
                        iceServers: [
                            { urls: creds.turnUrl.replace('turn:', 'stun:') },
                            { urls: creds.turnUrl, username: creds.turnUsername, credential: creds.turnPassword }
                        ]
                    }
                },
                delegate: {
                    onConnect: () => {
                        if (!everConnected) {
                            everConnected = true;
                            return;
                        }
                        console.log('[softphone] transport reconnected, re-registering');
                        registerNow();
                    },
                    onDisconnect: err => {
                        console.warn('[softphone] transport disconnected:', err?.message);
                        setRegistrationState('unregistered');
                        showToast('Softphone connection lost — reconnecting…', 'error');
                    },
                    onInvite: (invitation: Invitation) => {
                        const callerNumber = invitation.remoteIdentity.uri.user ?? 'Unknown';
                        setIncomingCall({ session: invitation, callerNumber });
                        wireSessionStateChange(invitation, callerNumber);
                        invitation.stateChange.addListener(state => {
                            if (state === SessionState.Established || state === SessionState.Terminated) {
                                setIncomingCall(current => (current?.session === invitation ? null : current));
                            }
                        });
                    }
                }
            });

            userAgentRef.current = userAgent;
            setRegistrationState('registering');

            try {
                await userAgent.start();
                const registerer = new Registerer(userAgent);
                registererRef.current = registerer;
                registerer.stateChange.addListener(state => {
                    if (state === RegistererState.Registered) setRegistrationState('registered');
                    else if (state === RegistererState.Unregistered) setRegistrationState('unregistered');
                });
                await registerNow();
            } catch (err) {
                console.error('[softphone] registration threw:', err);
                if (!cancelled) {
                    setRegistrationState('failed');
                    showToast('Softphone registration failed — you won’t receive browser calls', 'error');
                }
            }
        })();

        return () => {
            cancelled = true;
            registererRef.current?.unregister().catch(() => {});
            userAgentRef.current?.stop().catch(() => {});
            userAgentRef.current = null;
            registererRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.agentId]);

    // Tells the server "this browser is genuinely still connected" —
    // without it, agents.status='available' is just an unverified claim.
    // A dead tab, a lost connection, or a row seeded/provisioned as
    // available with nobody ever having logged in all look identical to
    // the rest of the app unless something actively confirms the opposite.
    // The ARI app flips anyone whose heartbeat goes stale back to offline
    // (see reconcileGhostAgents) — this is the signal that makes that safe.
    useEffect(() => {
        if (registrationState !== 'registered') return;

        const sendHeartbeat = () => {
            apiFetch('/api/agents/me/heartbeat', { method: 'PATCH' }).catch(() => {});
        };
        sendHeartbeat();
        const interval = setInterval(sendHeartbeat, 20000);
        return () => clearInterval(interval);
    }, [registrationState]);

    // Starts every session ready to take calls instead of requiring a manual
    // status flip first — but only once the softphone has actually
    // registered, not at raw login, since going 'available' before that
    // would let the queue ring an agent whose browser can't receive the
    // call yet. The ref guards against re-firing on every reconnect (a
    // dropped WebSocket auto-recovering shouldn't silently undo a deliberate
    // 'break').
    useEffect(() => {
        if (registrationState !== 'registered' || hasSetAvailableRef.current) return;
        hasSetAvailableRef.current = true;
        apiFetch('/api/agents/me/status', { method: 'PATCH', body: JSON.stringify({ status: 'available' }) }).catch(() => {});
    }, [registrationState]);

    // Microphone permission was previously only ever requested at the exact
    // moment of answering a real incoming call — the worst possible time to
    // discover it's blocked, with a customer already waiting. Requesting it
    // once here, right after registration, resolves the prompt (or reveals
    // an already-blocked state) during a calm moment instead. The stream
    // itself isn't needed — SIP.js acquires its own when a call is actually
    // answered — this call exists purely to trigger/check the permission.
    useEffect(() => {
        if (registrationState !== 'registered' || hasRequestedMicRef.current) return;
        hasRequestedMicRef.current = true;
        navigator.mediaDevices
            ?.getUserMedia({ audio: true })
            .then(stream => {
                stream.getTracks().forEach(track => track.stop());
                setMicPermissionDenied(false);
            })
            .catch(() => setMicPermissionDenied(true));
    }, [registrationState]);

    const answer = useCallback(async () => {
        if (!incomingCall) return;
        try {
            await incomingCall.session.accept({
                sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } }
            });
        } catch {
            showToast('Could not answer — check microphone permissions', 'error');
            incomingCall.session.reject().catch(() => {});
            setIncomingCall(null);
        }
    }, [incomingCall, showToast]);

    // The UI always clears its own call state here regardless of whether the
    // underlying SIP request actually succeeds — leaving a banner/status bar
    // the agent can't dismiss would be worse than a rare stale server-side
    // leg. The toast on failure at least tells them it may not have ended
    // cleanly, instead of failing in total silence.
    const warnIfCallActionFails = useCallback(
        () => showToast('That may not have ended cleanly on the network — refresh if audio continues', 'error'),
        [showToast]
    );

    const reject = useCallback(() => {
        if (!incomingCall) return;
        const { session } = incomingCall;
        // A plain reject() only works pre-answer — if the session already
        // raced to Established (e.g. the ARI side answered it a moment
        // before the click registered), reject() is a no-op/throws and the
        // call would silently keep running with no banner left to end it.
        if (session.state === SessionState.Established) session.bye().catch(warnIfCallActionFails);
        else session.reject().catch(warnIfCallActionFails);
        setIncomingCall(null);
    }, [incomingCall, warnIfCallActionFails]);

    const hangup = useCallback(() => {
        if (!activeCall) return;
        const { session } = activeCall;
        if (session.state === SessionState.Established) session.bye().catch(warnIfCallActionFails);
        else (session as Invitation).reject?.().catch(warnIfCallActionFails);
        setActiveCall(null);
    }, [activeCall, warnIfCallActionFails]);

    const toggleMute = useCallback(() => {
        if (!activeCall) return;
        const sender = getAudioSender(activeCall.session);
        if (!sender?.track) {
            // A real race if clicked the instant a call connects, before the
            // peer connection has an audio sender yet — surface it rather
            // than silently doing nothing, so the agent knows to retry.
            showToast('Call audio isn’t ready yet — try again in a moment', 'error');
            return;
        }
        sender.track.enabled = activeCall.muted;
        setActiveCall({ ...activeCall, muted: !activeCall.muted });
    }, [activeCall, showToast]);

    // Local-only hold: mutes both directions (we stop sending, and the far
    // end's audio is not attached while held). The far end hears silence,
    // not hold music — real MOH-on-hold would need Asterisk-side dialplan
    // support, not built yet. Labelled honestly in the UI for this reason.
    const toggleHold = useCallback(() => {
        if (!activeCall || !remoteAudioRef.current) return;
        const sender = getAudioSender(activeCall.session);
        if (!sender?.track) {
            showToast('Call audio isn’t ready yet — try again in a moment', 'error');
            return;
        }
        const nextHeld = !activeCall.held;
        sender.track.enabled = !nextHeld && !activeCall.muted;
        remoteAudioRef.current.muted = nextHeld;
        setActiveCall({ ...activeCall, held: nextHeld });
    }, [activeCall, showToast]);

    // "Earpiece by default, speaker on request" is the real product intent,
    // but browsers don't expose a distinct earpiece device to switch to —
    // enumerateDevices() just lists whatever named outputs the OS reports,
    // and the default one is already earpiece-equivalent on mobile Chrome.
    // So this toggles between that default and the first non-default output
    // it can find (labelled "speaker" when one is), rather than pretending
    // to control physical hardware it has no API for.
    const toggleSpeaker = useCallback(async () => {
        const audioEl = remoteAudioRef.current as SinkableAudioElement | null;
        if (!audioEl?.setSinkId) return;

        try {
            if (speakerOn) {
                await audioEl.setSinkId('');
                setSpeakerOn(false);
                return;
            }

            const devices = await navigator.mediaDevices.enumerateDevices();
            const outputs = devices.filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== '');
            const speaker = outputs.find(d => /speaker/i.test(d.label)) ?? outputs[0];

            if (!speaker) {
                showToast('No alternate output device found', 'error');
                return;
            }

            await audioEl.setSinkId(speaker.deviceId);
            setSpeakerOn(true);
        } catch {
            showToast('Failed to switch audio output', 'error');
        }
    }, [speakerOn, showToast]);

    const cancelOutgoingCall = useCallback(() => {
        if (!outgoingCall) return;
        const { session } = outgoingCall;
        // cancel() only works pre-answer. The ARI side answers our own leg
        // immediately (to give ringback while it dials out separately), so
        // by the time this fires the session may already be Established —
        // cancel() would silently fail there and leave the call running.
        if (session.state === SessionState.Established) session.bye().catch(warnIfCallActionFails);
        else session.cancel().catch(warnIfCallActionFails);
        setOutgoingCall(null);
    }, [outgoingCall, warnIfCallActionFails]);

    const placeCall = useCallback(
        async (destinationE164: string) => {
            const userAgent = userAgentRef.current;
            if (!userAgent || registrationState !== 'registered') {
                showToast('Softphone is not registered yet', 'error');
                return;
            }
            // A second concurrent call would silently overwrite
            // activeCall/outgoingCall's single-call state — the first call
            // would keep running server-side with no UI left to control it.
            if (activeCall || outgoingCall || incomingCall) {
                showToast('Finish or end the current call first', 'error');
                return;
            }
            const target = UserAgent.makeURI(`sip:${destinationE164}@${domainRef.current}`);
            if (!target) return;

            const inviter = new Inviter(userAgent, target);
            setOutgoingCall({ session: inviter, remoteNumber: destinationE164 });
            wireSessionStateChange(inviter, destinationE164);
            inviter.stateChange.addListener(state => {
                if (state === SessionState.Established || state === SessionState.Terminated) {
                    setOutgoingCall(current => (current?.session === inviter ? null : current));
                }
            });

            try {
                await inviter.invite({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
            } catch {
                showToast('Call failed', 'error');
                setOutgoingCall(current => (current?.session === inviter ? null : current));
            }
        },
        [registrationState, activeCall, outgoingCall, incomingCall, showToast, wireSessionStateChange]
    );

    return (
        <SoftphoneContext.Provider
            value={{
                registrationState,
                incomingCall,
                outgoingCall,
                activeCall,
                answer,
                reject,
                hangup,
                cancelOutgoingCall,
                toggleMute,
                toggleHold,
                placeCall,
                audioOutputSupported,
                speakerOn,
                toggleSpeaker,
                micPermissionDenied
            }}
        >
            {children}
        </SoftphoneContext.Provider>
    );
}

export function useSoftphone() {
    return useContext(SoftphoneContext);
}
