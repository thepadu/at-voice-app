import { useEffect, useState } from 'react';
import { useActiveCall } from '../../lib/activeCall';

function formatDuration(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export default function StatusBar() {
    const { activeCall, openQuickTicket } = useActiveCall();
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        if (!activeCall) return;
        const start = new Date(activeCall.created_at).getTime();
        const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
        // Deliberately depending on the primitive fields, not `activeCall`
        // itself — react-query hands back a new object on every 5s poll
        // even when nothing changed, and restarting this interval that
        // often would make the timer visibly stutter.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeCall?.session_id, activeCall?.created_at]);

    if (!activeCall) return null;

    return (
        <div className="status-bar">
            <div className="status-bar-info">
                <span className="status-bar-dot" />
                On call with <strong>{activeCall.caller}</strong>
                <span className="status-bar-timer">{formatDuration(seconds)}</span>
            </div>
            <button className="btn status-bar-ticket-btn" onClick={openQuickTicket}>+ Ticket</button>
        </div>
    );
}
