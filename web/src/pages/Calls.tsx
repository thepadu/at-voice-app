import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
    const queryClient = useQueryClient();

    const { data } = useQuery({
        queryKey: ['calls', tab],
        queryFn: () => apiFetch(`/api/calls?tab=${tab}`),
        refetchInterval: 10000
    });

    const calls: Call[] = data?.calls ?? [];

    const updateTicket = useMutation({
        mutationFn: ({ sessionId, ticketStatus }: { sessionId: string; ticketStatus: string }) =>
            apiFetch(`/api/calls/${sessionId}/ticket`, {
                method: 'POST',
                body: JSON.stringify({ ticket_status: ticketStatus })
            }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calls'] })
    });

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
                                    onChange={e =>
                                        updateTicket.mutate({ sessionId: call.session_id, ticketStatus: e.target.value })
                                    }
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
