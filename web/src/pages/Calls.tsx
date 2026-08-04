import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import StatusPill from '../components/StatusPill';

type Call = {
    session_id: string;
    caller: string;
    option_pressed: string | null;
    status: string | null;
    ticket_status: string | null;
    duration: number | null;
    created_at: string;
};

const TABS = ['all', 'incoming', 'outgoing', 'missed'] as const;
const TICKET_STATUSES = ['open', 'in_progress', 'resolved'] as const;

const OPTION_LABELS: Record<string, string> = {
    '1': 'Login Issue',
    '2': 'Deposit Issue',
    '3': 'Agent Request',
    '9': 'Repeat Menu'
};

export default function Calls() {
    const [tab, setTab] = useState<(typeof TABS)[number]>('all');
    const [calls, setCalls] = useState<Call[]>([]);

    useEffect(() => {
        apiFetch(`/api/calls?tab=${tab}`).then(data => setCalls(data.calls)).catch(() => {});
    }, [tab]);

    async function updateTicket(sessionId: string, ticketStatus: string) {
        // Optimistic update — the dropdown reflects the change immediately,
        // matching how the old HTML dashboard's inline select behaved.
        setCalls(calls.map(c => (c.session_id === sessionId ? { ...c, ticket_status: ticketStatus } : c)));
        await apiFetch(`/api/calls/${sessionId}/ticket`, {
            method: 'POST',
            body: JSON.stringify({ ticket_status: ticketStatus })
        });
    }

    return (
        <div>
            <div className="tabs">
                {TABS.map(t => (
                    <button
                        key={t}
                        className={t === tab ? 'tab active' : 'tab'}
                        onClick={() => setTab(t)}
                    >
                        {t[0].toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Caller</th>
                        <th>Issue</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Time</th>
                        <th>Ticket</th>
                    </tr>
                </thead>
                <tbody>
                    {calls.length === 0 && (
                        <tr><td colSpan={6} className="empty">No calls</td></tr>
                    )}
                    {calls.map(call => (
                        <tr key={call.session_id} className={call.status === 'ongoing' ? 'live-row' : ''}>
                            <td>{call.caller}</td>
                            <td>{call.option_pressed ? OPTION_LABELS[call.option_pressed] ?? call.option_pressed : '—'}</td>
                            <td><StatusPill value={call.status ?? 'unknown'} /></td>
                            <td>{call.duration ?? 0}s</td>
                            <td>{new Date(call.created_at).toLocaleString()}</td>
                            <td>
                                <select
                                    value={call.ticket_status ?? 'open'}
                                    onChange={e => updateTicket(call.session_id, e.target.value)}
                                >
                                    {TICKET_STATUSES.map(s => (
                                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                                    ))}
                                </select>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
