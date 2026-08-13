import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trophy, TrendingUp } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import StatusPill from '../components/StatusPill';
import CallsByHourChart from '../components/CallsByHourChart';

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
    outbound: number;
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

    const { data: liveData, isLoading: liveLoading } = useQuery({
        queryKey: ['calls-live'],
        queryFn: () => apiFetch('/api/calls/live'),
        refetchInterval: 10000
    });

    const { data: statsData, isLoading: statsLoading } = useQuery({
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
                <div className="card card-multi">
                    <div className="card-label">Contact Reasons</div>
                    <div className="card-multi-stats">
                        <div className="card-multi-stat">
                            <span className="card-multi-value">{summary?.login ?? '—'}</span>
                            <span className="card-multi-sublabel">Login</span>
                        </div>
                        <div className="card-multi-stat">
                            <span className="card-multi-value">{summary?.deposit ?? '—'}</span>
                            <span className="card-multi-sublabel">Deposit</span>
                        </div>
                        <div className="card-multi-stat">
                            <span className="card-multi-value">{summary?.agentRequests ?? '—'}</span>
                            <span className="card-multi-sublabel">Agent</span>
                        </div>
                    </div>
                </div>
                <div className="card">
                    <div className="card-label">Outgoing</div>
                    <p>{summary?.outbound ?? '—'}</p>
                </div>
                <div className="card">
                    <div className="card-label">Missed</div>
                    <p>{summary?.missed ?? '—'}</p>
                </div>
            </div>

            <CallsByHourChart hours={hourData?.hours ?? []} />

            <div className="panel">
                <div className="panel-header">
                    <h3>Live Now</h3>
                    {live.length > LIVE_NOW_LIMIT && (
                        <span className="hint" style={{ margin: 0 }}>
                            Showing {LIVE_NOW_LIMIT} of {live.length}
                        </span>
                    )}
                </div>
                {live.length === 0 && !liveLoading && <p className="empty">No calls in progress</p>}
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
                                    <td>{call.direction === 'Outbound' ? '↗ Outgoing' : '↙ Inbound'}</td>
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
                    <div className="panel-header">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Trophy size={18} /> Top Agents</h3>
                        <Link to="/analytics" className="btn-link">Full analytics →</Link>
                    </div>
                    {leaderboard.length === 0 && !statsLoading && <p className="empty">No agent call data yet</p>}
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
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={18} /> My Performance</h3>
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
                    ) : !statsLoading ? (
                        <p className="empty">No call data yet — this shows up once your linked number takes a call.</p>
                    ) : null}
                </div>
            )}
        </div>
    );
}
