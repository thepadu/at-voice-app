import { useEffect, useRef, useState } from 'react';
import { useSoftphone } from '../../lib/softphone';

// Browsers block audio autoplay until the page has seen at least one user
// gesture this session. Agents are usually already clicking around the
// dashboard before a call comes in, so this is mostly a formality — but if a
// call rings on a freshly-loaded, untouched tab, we skip the (blocked)
// ringtone and fall back to a purely visual cue instead of a silently
// swallowed error.
function useHasUserGestured() {
    const [gestured, setGestured] = useState(false);

    useEffect(() => {
        if (gestured) return;
        const onGesture = () => setGestured(true);
        window.addEventListener('pointerdown', onGesture, { once: true });
        window.addEventListener('keydown', onGesture, { once: true });
        return () => {
            window.removeEventListener('pointerdown', onGesture);
            window.removeEventListener('keydown', onGesture);
        };
    }, [gestured]);

    return gestured;
}

// Synthesized via Web Audio (two alternating tones, classic ring cadence)
// rather than shipping an audio file — one less asset to deploy/host.
function useRingtone(playing: boolean) {
    const audioCtxRef = useRef<AudioContext | null>(null);
    const stopRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!playing) {
            stopRef.current?.();
            stopRef.current = null;
            return;
        }

        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        let cancelled = false;
        let timeoutId: number;

        function ringOnce() {
            if (cancelled) return;
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();
            osc1.frequency.value = 440;
            osc2.frequency.value = 480;
            gain.gain.value = 0.15;
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);
            osc1.start();
            osc2.start();
            osc1.stop(ctx.currentTime + 1);
            osc2.stop(ctx.currentTime + 1);
            timeoutId = window.setTimeout(ringOnce, 3000);
        }
        ringOnce();

        stopRef.current = () => {
            cancelled = true;
            clearTimeout(timeoutId);
            ctx.close().catch(() => {});
        };

        return () => stopRef.current?.();
    }, [playing]);
}

// Requested once, right when a call first rings, rather than proactively at
// login — asking for notification permission out of the blue (before the
// agent has any reason to want it) is a common way to get "block" clicked
// reflexively, which then also blocks it for every future call.
function useCallNotification(incomingCall: { callerNumber: string } | null) {
    const shownFor = useRef<string | null>(null);

    useEffect(() => {
        if (!incomingCall) {
            shownFor.current = null;
            return;
        }
        // Only worth interrupting the agent if they're not even looking at
        // this tab — otherwise the banner itself is enough.
        if (!document.hidden) return;
        if (shownFor.current === incomingCall.callerNumber) return;
        shownFor.current = incomingCall.callerNumber;

        if (!('Notification' in window)) return;

        const show = () => new Notification('Incoming call', { body: incomingCall.callerNumber, tag: 'incoming-call' });

        if (Notification.permission === 'granted') {
            show();
        } else if (Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') show();
            });
        }
    }, [incomingCall]);
}

export default function IncomingCallBanner() {
    const { incomingCall, answer, reject } = useSoftphone();
    const hasGestured = useHasUserGestured();
    const originalTitle = useRef(document.title);

    useRingtone(!!incomingCall && hasGestured);
    useCallNotification(incomingCall);

    useEffect(() => {
        const original = originalTitle.current;

        if (!incomingCall) {
            document.title = original;
            return;
        }

        const flashInterval = setInterval(() => {
            document.title = document.title === original ? '📞 Incoming call…' : original;
        }, 1000);

        return () => {
            clearInterval(flashInterval);
            document.title = original;
        };
    }, [incomingCall]);

    if (!incomingCall) return null;

    return (
        <div className={`incoming-call-banner ${!hasGestured ? 'incoming-call-banner-pulse' : ''}`}>
            <div className="incoming-call-info">
                <span className="incoming-call-icon" aria-hidden="true">📞</span>
                Incoming call from <strong>{incomingCall.callerNumber}</strong>
            </div>
            <div className="incoming-call-actions">
                <button className="btn incoming-call-answer" onClick={answer}>
                    Answer
                </button>
                <button className="btn incoming-call-reject" onClick={reject}>
                    Reject
                </button>
            </div>
        </div>
    );
}
