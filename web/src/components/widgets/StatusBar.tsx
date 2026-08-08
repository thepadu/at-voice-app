import { useEffect, useState } from 'react';
import { useActiveCall } from '../../lib/activeCall';
import { useSoftphone } from '../../lib/softphone';

function formatDuration(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export default function StatusBar() {
    const { activeCall: polledCall, openQuickTicket } = useActiveCall();
    const { activeCall: softphoneCall, toggleMute, toggleHold, hangup } = useSoftphone();
    const [seconds, setSeconds] = useState(0);

    // SIP.js's own session is the source of truth for anything the browser
    // directly witnesses in real time (this bar's render condition, mute,
    // hold) — the 5s Supabase poll stays authoritative for things only the
    // server knows (wrap-up/ticket triggers), so the two don't fight over
    // the same state. Falling back to the polled call keeps the bar visible
    // during the brief gap right after answering, before the local SIP.js
    // session has finished transitioning to Established.
    const caller = softphoneCall?.remoteNumber ?? polledCall?.caller;
    const startedAt = softphoneCall?.startedAt ?? (polledCall ? new Date(polledCall.created_at).getTime() : null);

    useEffect(() => {
        if (!startedAt) return;
        const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [startedAt]);

    if (!caller) return null;

    return (
        <div className="status-bar">
            <div className="status-bar-info">
                <span className="status-bar-dot" />
                On call with <strong>{caller}</strong>
                <span className="status-bar-timer">{formatDuration(seconds)}</span>
            </div>
            <div className="status-bar-actions">
                {softphoneCall && (
                    <>
                        <button
                            className={`btn status-bar-control-btn ${softphoneCall.muted ? 'status-bar-control-active' : ''}`}
                            onClick={toggleMute}
                        >
                            {softphoneCall.muted ? 'Unmute' : 'Mute'}
                        </button>
                        <button
                            className={`btn status-bar-control-btn ${softphoneCall.held ? 'status-bar-control-active' : ''}`}
                            onClick={toggleHold}
                            title={softphoneCall.held ? 'They currently hear silence' : "They'll hear silence, not hold music"}
                        >
                            {softphoneCall.held ? 'Resume' : 'Hold'}
                        </button>
                        <button className="btn status-bar-end-btn" onClick={hangup}>
                            End call
                        </button>
                    </>
                )}
                <button className="btn status-bar-ticket-btn" onClick={openQuickTicket}>
                    + Ticket
                </button>
            </div>
        </div>
    );
}
