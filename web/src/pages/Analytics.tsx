import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import CallsByHourChart from '../components/CallsByHourChart';
import Pagination from '../components/Pagination';

type Summary = {
    total: number;
    login: number;
    deposit: number;
    agentRequests: number;
    outbound: number;
    missed: number;
    missedByReason: { abandoned: number; forwarded: number; afterHours: number };
};

type AgentStat = { id: number | null; name: string; total: number; answered: number; missed: number; avgHandleTime: number };

const PAGE_SIZE = 10;

function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function Analytics() {
    const today = useMemo(todayISO, []);
    const [statsPage, setStatsPage] = useState(1);

    const { data: callsData } = useQuery({
        queryKey: ['analytics-calls', today],
        queryFn: () => apiFetch(`/api/calls?from=${today}&to=${today}`),
        refetchInterval: 30000
    });

    const { data: hourData } = useQuery({
        queryKey: ['calls-by-hour'],
        queryFn: () => apiFetch('/api/calls/by-hour'),
        refetchInterval: 60000
    });

    const { data: statsData } = useQuery({
        queryKey: ['agents-stats-full'],
        queryFn: () => apiFetch('/api/agents/stats'),
        refetchInterval: 30000
    });

    const summary: Summary | undefined = callsData?.summary;
    const agentStats: AgentStat[] = useMemo(() => statsData?.agents ?? [], [statsData]);

    const ranked = useMemo(() => [...agentStats].sort((a, b) => b.answered - a.answered), [agentStats]);
    const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
    const pageOfStats = ranked.slice((statsPage - 1) * PAGE_SIZE, statsPage * PAGE_SIZE);

    const avgHandleTimeAll = useMemo(() => {
        const withCalls = agentStats.filter(a => a.answered > 0);
        if (!withCalls.length) return 0;
        return Math.round(withCalls.reduce((sum, a) => sum + a.avgHandleTime, 0) / withCalls.length);
    }, [agentStats]);

    return (
        <div>
            <p className="hint" style={{ marginTop: 0 }}>
                Today, {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>

            <div className="cards">
                <div className="card">
                    <div className="card-label">Total Calls</div>
                    <p>{summary?.total ?? '—'}</p>
                </div>
                <div className="card">
                    <div className="card-label">Incoming</div>
                    <p>{summary ? summary.total - summary.outbound : '—'}</p>
                </div>
                <div className="card">
                    <div className="card-label">Outbound</div>
                    <p>{summary?.outbound ?? '—'}</p>
                </div>
                <div className="card">
                    <div className="card-label">Agent Requests</div>
                    <p>{summary?.agentRequests ?? '—'}</p>
                </div>
                <div className="card">
                    <div className="card-label">Missed</div>
                    <p>{summary?.missed ?? '—'}</p>
                </div>
                <div className="card">
                    <div className="card-label">Avg Handle Time (all-time)</div>
                    <p>{avgHandleTimeAll}s</p>
                </div>
            </div>

            <CallsByHourChart hours={hourData?.hours ?? []} />

            <div className="panel">
                <h3>Missed calls, by reason</h3>
                <p className="hint">Today only — see the Calls page for the full history.</p>
                <div className="analytics-row">
                    <span>Abandoned before an agent answered</span>
                    <strong>{summary?.missedByReason.abandoned ?? 0}</strong>
                </div>
                <div className="analytics-row">
                    <span>Forwarded (nobody was online)</span>
                    <strong>{summary?.missedByReason.forwarded ?? 0}</strong>
                </div>
                <div className="analytics-row">
                    <span>Outside business hours</span>
                    <strong>{summary?.missedByReason.afterHours ?? 0}</strong>
                </div>
            </div>

            <div className="panel">
                <h3>🏆 Agent performance (all-time)</h3>
                {ranked.length === 0 && <p className="empty">No agent call data yet.</p>}
                {ranked.length > 0 && (
                    <>
                        <table>
                            <thead>
                                <tr>
                                    <th>Rank</th>
                                    <th>Agent</th>
                                    <th>Total Calls</th>
                                    <th>Answered</th>
                                    <th>Missed</th>
                                    <th>Avg Handle Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageOfStats.map((a, i) => (
                                    <tr key={a.id ?? a.name}>
                                        <td style={{ color: 'var(--muted)', fontWeight: 700 }}>
                                            {(statsPage - 1) * PAGE_SIZE + i + 1}
                                        </td>
                                        <td>{a.name}</td>
                                        <td>{a.total}</td>
                                        <td>{a.answered}</td>
                                        <td>{a.missed}</td>
                                        <td>{a.avgHandleTime}s</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Pagination page={statsPage} totalPages={totalPages} onPageChange={setStatsPage} />
                    </>
                )}
            </div>
        </div>
    );
}
