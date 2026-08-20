// Moneto brand palette: teal for "good/active" states, a lighter tealGreen
// for "in progress right now", gold-orange for "needs attention soon", and
// coral for anything that didn't go as planned. `ringing`, `break`, and
// `forwarded` used to all share the same gold-orange despite being three
// unrelated concepts (an urgent transient state, a calm intentional pause,
// and a missed-call outcome) — differentiated below, since color is one of
// the fastest things to scan across a table full of these pills even
// though text is always shown alongside it too.
export const STATUS_COLORS: Record<string, string> = {
    available: '#17A697',
    on_call: '#4DB8AA',
    ringing: '#F39C12',
    break: '#5B8DBE',
    offline: '#757575',
    completed: '#17A697',
    ongoing: '#4DB8AA',
    queued: '#4DB8AA',
    dialing: '#4DB8AA',
    failed: '#EF5350',
    forwarded: '#E67E22',
    after_hours: '#757575'
};

export default function StatusPill({ value, label }: { value: string; label?: string }) {
    const color = STATUS_COLORS[value] || '#757575';
    return (
        <span className="status-pill" style={{ background: color }}>
            {label ?? value.replace('_', ' ')}
        </span>
    );
}
