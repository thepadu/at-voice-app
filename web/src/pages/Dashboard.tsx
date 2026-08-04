import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import StatusPill from '../components/StatusPill';

type Call = {
    session_id: string;
    caller: string;
    status: string | null;
    created_at: string;
};

type Summary = {
    total: number;
    login: number;
    deposit: number;
    agentRequests: number;
    missed: number;
};

export default function Dashboard() {
    const [summary, setSummary] = useState<Summary | null>(null);
    const [live, setLive] = useState<Call[]>([]);

    useEffect(() => {
        function load() {
            apiFetch('/api/calls').then(data => setSummary(data.summary)).catch(() => {});
            apiFetch('/api/calls/live').then(data => setLive(data.calls)).catch(() => {});
        }

        load();
        // Matches the 10s auto-refresh the old HTML dashboard used.
        const interval = setInterval(load, 10000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div>
            <div className="cards">
                <div className="card"><p>{summary?.total ?? '—'}</p>Total Calls</div>
                <div className="card"><p>{summary?.login ?? '—'}</p>Login Issues</div>
                <div className="card"><p>{summary?.deposit ?? '—'}</p>Deposit Issues</div>
                <div className="card"><p>{summary?.agentRequests ?? '—'}</p>Agent Requests</div>
                <div className="card"><p>{summary?.missed ?? '—'}</p>Missed</div>
            </div>

            <div className="panel">
                <h3>🔴 Live Now</h3>
                {live.length === 0 && <p className="empty">No calls in progress</p>}
                {live.length > 0 && (
                    <table>
                        <tbody>
                            {live.map(call => (
                                <tr key={call.session_id} className="live-row">
                                    <td>{call.caller}</td>
                                    <td><StatusPill value={call.status ?? 'unknown'} /></td>
                                    <td>{new Date(call.created_at).toLocaleTimeString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
