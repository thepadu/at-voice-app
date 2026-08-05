import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
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

type AgentStat = {
    id: number | null;
    name: string;
    total: number;
    answered: number;
    missed: number;
    avgHandleTime: number;
};

export default function Dashboard() {
    const { user, isSupervisor } = useAuth();

    const { data: callsData } = useQuery({
        queryKey: ['calls-summary'],
        queryFn: () => apiFetch('/api/calls'),
        refetchInterval: 10000
    });

    const { data: liveData } = useQuery({
        queryKey: ['calls-live'],
        queryFn: () => apiFetch('/api/calls/live'),
        refetchInterval: 10000
    });

    const { data: statsData } = useQuery({
        queryKey: ['agents-stats'],
        queryFn: () => apiFetch('/api/agents/stats'),
        refetchInterval: 30000
    });

    const summary: Summary | undefined = callsData?.summary;
    const live: Call[] = liveData?.calls ?? [];
    const agentStats: AgentStat[] = statsData?.agents ?? [];

    const leaderboard = [...agentStats].sort((a, b) => b.answered - a.answered).slice(0, 5);
    const myStats = user?.agentId != null ? agentStats.find(a => a.id === user.agentId) : undefined;

    return (
        <div>
            <div className="cards">
                <div className="card">
                    <div className="card-label">Total Calls</div>
                    <p>{summary?.total ?? '—'}</p>
                </div>
                <div className="card">
                    <div className="card-label">Login Issues</div>
                    <p>{summary?.login ?? '—'}</p>
                </div>
                <div className="card">
                    <div className="card-label">Deposit Issues</div>
                    <p>{summary?.deposit ?? '—'}</p>
                </div>
                <div className="card">
                    <div className="card-label">Agent Requests</div>
                    <p>{summary?.agentRequests ?? '—'}</p>
                </div>
                <div className="card">
                    <div className="card-label">Missed</div>
                    <p>{summary?.missed ?? '—'}</p>
                </div>
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
                                    <td>
                                        <StatusPill value={call.status ?? 'unknown'} />
                                    </td>
                                    <td>{new Date(call.created_at).toLocaleTimeString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {isSupervisor ? (
                <div className="panel">
                    <h3>🏆 Top Agents</h3>
                    {leaderboard.length === 0 && <p className="empty">No agent call data yet</p>}
                    {leaderboard.length > 0 && (
                        <table>
                            <tbody>
                                {leaderboard.map((a, i) => (
                                    <tr key={a.id ?? a.name}>
                                        <td style={{ width: 24, color: 'var(--muted)', fontWeight: 700 }}>{i + 1}</td>
                                        <td>{a.name}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{a.answered} calls</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            ) : (
                <div className="panel">
                    <h3>📈 My Performance</h3>
                    {myStats ? (
                        <div>
                            <div className="analytics-row">
                                <span>Calls answered</span>
                                <strong>{myStats.answered}</strong>
                            </div>
                            <div className="analytics-row">
                                <span>Missed</span>
                                <strong>{myStats.missed}</strong>
                            </div>
                            <div className="analytics-row">
                                <span>Avg handle time</span>
                                <strong>{myStats.avgHandleTime}s</strong>
                            </div>
                        </div>
                    ) : (
                        <p className="empty">No call data yet — this shows up once your linked number takes a call.</p>
                    )}
                </div>
            )}
        </div>
    );
}
