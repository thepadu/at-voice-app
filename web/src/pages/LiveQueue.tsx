import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

type QueuedCall = {
    session_id: string;
    caller: string;
    waitSeconds: number;
};

function formatWait(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function waitRowClass(sec: number) {
    if (sec >= 90) return 'live-row queue-row-danger';
    if (sec >= 60) return 'queue-row-warning';
    return '';
}

export default function LiveQueue() {
    const { data: queueData } = useQuery({
        queryKey: ['queue'],
        queryFn: () => apiFetch('/api/queue'),
        refetchInterval: 5000
    });

    const { data: countData } = useQuery({
        queryKey: ['agents-available-count'],
        queryFn: () => apiFetch('/api/agents/available-count'),
        refetchInterval: 15000
    });

    const calls: QueuedCall[] = queueData?.calls ?? [];
    const stats = queueData?.stats ?? { inQueue: 0, avgWaitSeconds: 0, longestWaitSeconds: 0 };

    return (
        <div>
            <div className="cards">
                <div className="card">
                    <div className="card-label">In Queue</div>
                    <p>{stats.inQueue}</p>
                </div>
                <div className="card">
                    <div className="card-label">Avg Wait</div>
                    <p>{formatWait(stats.avgWaitSeconds)}</p>
                </div>
                <div className="card">
                    <div className="card-label">Longest Wait</div>
                    <p>{formatWait(stats.longestWaitSeconds)}</p>
                </div>
                <div className="card">
                    <div className="card-label">Agents Available</div>
                    <p>{countData?.count ?? '—'}</p>
                </div>
            </div>

            <div className="panel">
                <p className="hint">
                    Available agents accept the next call by pressing 1 on their phone once they're on
                    standby — there's no clickable "Answer" here, since Africa's Talking's phone-based
                    queueing has no way for a web page to pick up a real call.
                </p>

                <table>
                    <thead>
                        <tr>
                            <th>Caller</th>
                            <th>Wait</th>
                        </tr>
                    </thead>
                    <tbody>
                        {calls.length === 0 && (
                            <tr><td colSpan={2} className="empty">Queue is empty. All callers answered.</td></tr>
                        )}
                        {calls.map(call => (
                            <tr key={call.session_id} className={waitRowClass(call.waitSeconds)}>
                                <td>{call.caller}</td>
                                <td style={{ fontWeight: 700 }}>{formatWait(call.waitSeconds)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
