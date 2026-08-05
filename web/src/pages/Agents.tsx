import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';
import { useModalA11y } from '../lib/useModalA11y';
import ConfirmDialog from '../components/ConfirmDialog';
import StatusPill from '../components/StatusPill';

type Agent = {
    id: number;
    name: string;
    phone: string;
    email: string | null;
    status: 'available' | 'on_call' | 'offline';
    role: 'agent' | 'supervisor';
};

type AgentStat = { id: number | null; name: string; total: number; answered: number; missed: number; avgHandleTime: number };

const EMPTY_FORM = { name: '', phone: '', email: '', role: 'agent' as Agent['role'] };

function initials(name: string) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function Agents() {
    const queryClient = useQueryClient();
    const showToast = useToast();

    const { data: agentsData } = useQuery({ queryKey: ['agents'], queryFn: () => apiFetch('/api/agents') });
    const { data: statsData } = useQuery({ queryKey: ['agents-stats'], queryFn: () => apiFetch('/api/agents/stats') });

    const agents: Agent[] = agentsData?.agents ?? [];
    const stats: AgentStat[] = statsData?.agents ?? [];

    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formError, setFormError] = useState('');
    const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);

    function invalidate() {
        queryClient.invalidateQueries({ queryKey: ['agents'] });
        queryClient.invalidateQueries({ queryKey: ['agents-available-count'] });
    }

    const saveAgent = useMutation({
        mutationFn: () =>
            editingId
                ? apiFetch(`/api/agents/${editingId}`, { method: 'PATCH', body: JSON.stringify(form) })
                : apiFetch('/api/agents', { method: 'POST', body: JSON.stringify(form) }),
        onSuccess: () => {
            showToast(editingId ? 'Agent updated' : 'Agent added');
            setFormOpen(false);
            invalidate();
        },
        onError: (err: unknown) => setFormError(err instanceof Error ? err.message : 'Something went wrong')
    });

    const toggleStatus = useMutation({
        mutationFn: ({ id, status }: { id: number; status: Agent['status'] }) =>
            apiFetch(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
        onSuccess: invalidate,
        onError: () => showToast('Failed to update status', 'error')
    });

    const deleteAgent = useMutation({
        mutationFn: (id: number) => apiFetch(`/api/agents/${id}`, { method: 'DELETE' }),
        onSuccess: () => {
            showToast('Agent removed');
            invalidate();
        },
        onError: () => showToast('Failed to remove agent', 'error'),
        onSettled: () => setPendingDelete(null)
    });

    function openAddForm() {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setFormError('');
        setFormOpen(true);
    }

    function openEditForm(agent: Agent) {
        setEditingId(agent.id);
        setForm({ name: agent.name, phone: agent.phone, email: agent.email ?? '', role: agent.role });
        setFormError('');
        setFormOpen(true);
    }

    function nextStatus(agent: Agent): Agent['status'] {
        if (agent.status === 'on_call') return 'offline';
        return agent.status === 'available' ? 'offline' : 'available';
    }

    const containerRef = useModalA11y(formOpen, () => setFormOpen(false));

    return (
        <div>
            <div className="panel">
                <div className="panel-header">
                    <h3>👥 Team</h3>
                    <button className="btn btn-primary" onClick={openAddForm}>+ Add Agent</button>
                </div>
                <p className="hint">
                    Only <strong>available</strong> agents are dialed — all at once — when a caller asks for support.
                </p>

                {agents.length === 0 && <p className="empty">No agents yet — add your first one.</p>}

                <div className="agent-grid">
                    {agents.map(agent => (
                        <div className="agent-card" key={agent.id}>
                            <div className="agent-card-header">
                                <div className="agent-avatar">{initials(agent.name)}</div>
                                <div style={{ minWidth: 0 }}>
                                    <div className="agent-card-name">{agent.name}</div>
                                    <div className="agent-card-meta">{agent.phone}</div>
                                </div>
                            </div>
                            <div className="agent-card-status">
                                <button
                                    className="pill-toggle"
                                    onClick={() => toggleStatus.mutate({ id: agent.id, status: nextStatus(agent) })}
                                    title={agent.status === 'on_call' ? 'Click to go offline' : undefined}
                                >
                                    <StatusPill value={agent.status} />
                                </button>
                                {agent.role === 'supervisor' && (
                                    <span className="status-pill" style={{ background: '#334155', marginLeft: 6 }}>
                                        Supervisor
                                    </span>
                                )}
                            </div>
                            <div className="agent-card-actions">
                                <button className="btn btn-link" onClick={() => openEditForm(agent)}>Edit</button>
                                <button className="btn btn-link btn-link-danger" onClick={() => setPendingDelete(agent)}>
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="panel">
                <h3>📈 Performance</h3>
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
                        {stats.length === 0 && (
                            <tr><td colSpan={5} className="empty">No agent call data yet</td></tr>
                        )}
                        {stats.map(s => (
                            <tr key={s.id ?? s.name}>
                                <td>{s.name}</td>
                                <td>{s.total}</td>
                                <td>{s.answered}</td>
                                <td>{s.missed}</td>
                                <td>{s.avgHandleTime}s</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {formOpen && (
                <div className="modal-overlay" onClick={() => setFormOpen(false)}>
                    <div ref={containerRef} className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                        <h3>{editingId ? 'Edit Agent' : 'Add Agent'}</h3>

                        <label>
                            Name
                            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                        </label>
                        <label>
                            Phone (+254...)
                            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+254712345678" />
                        </label>
                        <label>
                            Email (optional — links their Google login)
                            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="agent@chumz.io" />
                        </label>
                        <label>
                            Role
                            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Agent['role'] })}>
                                <option value="agent">Agent</option>
                                <option value="supervisor">Supervisor</option>
                            </select>
                        </label>

                        {formError && <p className="error">{formError}</p>}

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={() => saveAgent.mutate()} disabled={saveAgent.isPending}>
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={!!pendingDelete}
                title="Remove agent"
                message={`Remove ${pendingDelete?.name}? They'll no longer be dialed for support calls.`}
                confirmLabel="Remove"
                danger
                onConfirm={() => pendingDelete && deleteAgent.mutate(pendingDelete.id)}
                onCancel={() => setPendingDelete(null)}
            />
        </div>
    );
}
