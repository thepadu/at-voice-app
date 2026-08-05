import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';
import StatusPill from '../components/StatusPill';

type Call = {
    session_id: string;
    caller: string;
    status: string | null;
    duration: number | null;
    created_at: string;
};

type Tab = 'missed' | 'log';

export default function OutboundMissed() {
    const [tab, setTab] = useState<Tab>('missed');
    const showToast = useToast();

    const { data: missedData } = useQuery({
        queryKey: ['calls', 'missed'],
        queryFn: () => apiFetch('/api/calls?tab=missed'),
        enabled: tab === 'missed'
    });

    const { data: logData } = useQuery({
        queryKey: ['calls', 'outgoing'],
        queryFn: () => apiFetch('/api/calls?tab=outgoing'),
        enabled: tab === 'log'
    });

    const missed: Call[] = missedData?.calls ?? [];
    const log: Call[] = logData?.calls ?? [];

    async function callBack(caller: string) {
        try {
            await apiFetch('/call', { method: 'POST', body: JSON.stringify({ phone: caller }) });
            showToast(`📞 Calling ${caller} back`);
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Call failed', 'error');
        }
    }

    return (
        <div>
            <div className="tabs">
                <button className={tab === 'missed' ? 'tab active' : 'tab'} onClick={() => setTab('missed')}>
                    Missed Calls ({missed.length})
                </button>
                <button className={tab === 'log' ? 'tab active' : 'tab'} onClick={() => setTab('log')}>
                    Outbound Log
                </button>
            </div>

            {tab === 'missed' && (
                <table>
                    <thead>
                        <tr>
                            <th>Caller</th>
                            <th>Time</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {missed.length === 0 && (
                            <tr><td colSpan={3} className="empty">No missed calls outstanding.</td></tr>
                        )}
                        {missed.map(call => (
                            <tr key={call.session_id}>
                                <td>{call.caller}</td>
                                <td>{new Date(call.created_at).toLocaleString()}</td>
                                <td>
                                    <button className="btn btn-primary" onClick={() => callBack(call.caller)}>
                                        Call back
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {tab === 'log' && (
                <table>
                    <thead>
                        <tr>
                            <th>Number</th>
                            <th>Duration</th>
                            <th>Outcome</th>
                            <th>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {log.length === 0 && (
                            <tr><td colSpan={4} className="empty">No outbound calls yet.</td></tr>
                        )}
                        {log.map(call => (
                            <tr key={call.session_id}>
                                <td>{call.caller}</td>
                                <td>{call.duration ?? 0}s</td>
                                <td><StatusPill value={call.status ?? 'unknown'} /></td>
                                <td>{new Date(call.created_at).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
