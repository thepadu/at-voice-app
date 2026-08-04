import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

type AgentStat = {
    agent: string;
    total: number;
    answered: number;
    missed: number;
    avgHandleTime: number;
};

export default function Agents() {
    const [agents, setAgents] = useState<AgentStat[]>([]);

    useEffect(() => {
        apiFetch('/api/agents/stats').then(data => setAgents(data.agents)).catch(() => {});
    }, []);

    return (
        <div className="panel">
            <h3>👤 Agent Performance</h3>
            <table>
                <thead>
                    <tr>
                        <th>Agent</th>
                        <th>Total Calls</th>
                        <th>Answered</th>
                        <th>Missed</th>
                        <th>Avg Handle Time</th>
                    </tr>
                </thead>
                <tbody>
                    {agents.length === 0 && (
                        <tr><td colSpan={5} className="empty">No agent call data yet</td></tr>
                    )}
                    {agents.map(a => (
                        <tr key={a.agent}>
                            <td>{a.agent}</td>
                            <td>{a.total}</td>
                            <td>{a.answered}</td>
                            <td>{a.missed}</td>
                            <td>{a.avgHandleTime}s</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
