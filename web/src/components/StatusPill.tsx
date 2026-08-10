// Moneto brand palette: teal for "good/active" states, a lighter tealGreen
// for "in progress right now", gold-orange for "needs attention soon", and
// coral for anything that didn't go as planned.
const COLORS: Record<string, string> = {
    available: '#17A697',
    on_call: '#4DB8AA',
    ringing: '#F39C12',
    break: '#F39C12',
    offline: '#757575',
    completed: '#17A697',
    ongoing: '#4DB8AA',
    queued: '#4DB8AA',
    dialing: '#4DB8AA',
    failed: '#EF5350',
    forwarded: '#F39C12',
    after_hours: '#757575',
    open: '#EF5350',
    in_progress: '#F39C12',
    resolved: '#17A697'
};

export default function StatusPill({ value, label }: { value: string; label?: string }) {
    const color = COLORS[value] || '#757575';
    return (
        <span className="status-pill" style={{ background: color }}>
            {label ?? value.replace('_', ' ')}
        </span>
    );
}
