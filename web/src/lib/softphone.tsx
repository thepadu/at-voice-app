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
    placeCall: async () => {}
});

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
        setActiveCall(null);
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

            const userAgent = new UserAgent({
                uri,
                transportOptions: { server: creds.wssUrl },
                authorizationUsername: creds.username,
                authorizationPassword: creds.password,
                delegate: {
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
                await registerer.register({
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

    const reject = useCallback(() => {
        if (!incomingCall) return;
        incomingCall.session.reject().catch(() => {});
        setIncomingCall(null);
    }, [incomingCall]);

    const hangup = useCallback(() => {
        if (!activeCall) return;
        const { session } = activeCall;
        if (session.state === SessionState.Established) session.bye().catch(() => {});
        else (session as Invitation).reject?.().catch(() => {});
        setActiveCall(null);
    }, [activeCall]);

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

    const cancelOutgoingCall = useCallback(() => {
        if (!outgoingCall) return;
        outgoingCall.session.cancel().catch(() => {});
        setOutgoingCall(null);
    }, [outgoingCall]);

    const placeCall = useCallback(
        async (destinationE164: string) => {
            const userAgent = userAgentRef.current;
            if (!userAgent || registrationState !== 'registered') {
                showToast('Softphone is not registered yet', 'error');
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
        [registrationState, showToast, wireSessionStateChange]
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
                placeCall
            }}
        >
            {children}
        </SoftphoneContext.Provider>
    );
}

export function useSoftphone() {
    return useContext(SoftphoneContext);
}
