import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import StatusPill from '../components/StatusPill';

type Call = {
    session_id: string;
    caller: string;
    status: string | null;
    created_at: string;
    direction?: string | null;
    agent_name?: string | null;
};

// Keeps the panel a fixed, predictable height instead of growing unbounded
// as concurrent call volume scales up — the full list is always one click
// away on the dedicated Live Queue / Calls pages.
const LIVE_NOW_LIMIT = 8;

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

    const { data: hourData } = useQuery({
        queryKey: ['calls-by-hour'],
        queryFn: () => apiFetch('/api/calls/by-hour'),
        refetchInterval: 60000
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

            <CallsByHourChart hours={hourData?.hours ?? []} />

            <div className="panel">
                <div className="panel-header">
                    <h3>🔴 Live Now</h3>
                    {live.length > LIVE_NOW_LIMIT && (
                        <span className="hint" style={{ margin: 0 }}>
                            Showing {LIVE_NOW_LIMIT} of {live.length}
                        </span>
                    )}
                </div>
                {live.length === 0 && <p className="empty">No calls in progress</p>}
                {live.length > 0 && (
                    <table>
                        <thead>
                            <tr>
                                <th>Caller</th>
                                <th>Direction</th>
                                <th>Status</th>
                                <th>Agent</th>
                                <th>Started</th>
                            </tr>
                        </thead>
                        <tbody>
                            {live.slice(0, LIVE_NOW_LIMIT).map(call => (
                                <tr key={call.session_id} className="live-row">
                                    <td>{call.caller}</td>
                                    <td>{call.direction === 'Outbound' ? '↗ Outbound' : '↙ Inbound'}</td>
                                    <td>
                                        <StatusPill value={call.status ?? 'unknown'} />
                                    </td>
                                    <td>{call.agent_name ?? '—'}</td>
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

function CallsByHourChart({ hours }: { hours: { hour: number; count: number }[] }) {
    const max = Math.max(1, ...hours.map(h => h.count));

    return (
        <div className="panel">
            <h3>Calls by hour</h3>
            <div className="hour-chart">
                {hours.map(h => (
                    <div className="hour-chart-bar-col" key={h.hour}>
                        <div className="hour-chart-bar" style={{ height: `${Math.round((h.count / max) * 100)}%` }} />
                        <div className="hour-chart-label">{h.hour % 12 === 0 ? 12 : h.hour % 12}{h.hour < 12 ? 'a' : 'p'}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
