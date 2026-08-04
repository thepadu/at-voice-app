import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';
import ConfirmDialog from '../components/ConfirmDialog';
import StatusPill from '../components/StatusPill';

type Agent = {
    id: number;
    name: string;
    phone: string;
    email: string | null;
    status: 'available' | 'offline';
};

type AgentStat = {
    agent: string;
    total: number;
    answered: number;
    missed: number;
    avgHandleTime: number;
};

const EMPTY_FORM = { name: '', phone: '', email: '' };

export default function Agents() {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [stats, setStats] = useState<AgentStat[]>([]);
    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formError, setFormError] = useState('');
    const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);
    const showToast = useToast();

    function loadAgents() {
        apiFetch('/api/agents').then(data => setAgents(data.agents)).catch(() => {});
    }

    useEffect(() => {
        loadAgents();
        apiFetch('/api/agents/stats').then(data => setStats(data.agents)).catch(() => {});
    }, []);

    function openAddForm() {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setFormError('');
        setFormOpen(true);
    }

    function openEditForm(agent: Agent) {
        setEditingId(agent.id);
        setForm({ name: agent.name, phone: agent.phone, email: agent.email ?? '' });
        setFormError('');
        setFormOpen(true);
    }

    async function saveForm() {
        setFormError('');
        try {
            if (editingId) {
                await apiFetch(`/api/agents/${editingId}`, { method: 'PATCH', body: JSON.stringify(form) });
                showToast('Agent updated');
            } else {
                await apiFetch('/api/agents', { method: 'POST', body: JSON.stringify(form) });
                showToast('Agent added');
            }
            setFormOpen(false);
            loadAgents();
        } catch (err: any) {
            setFormError(err.message || 'Something went wrong');
        }
    }

    async function toggleStatus(agent: Agent) {
        const nextStatus = agent.status === 'available' ? 'offline' : 'available';
        setAgents(agents.map(a => (a.id === agent.id ? { ...a, status: nextStatus } : a)));
        try {
            await apiFetch(`/api/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
        } catch {
            showToast('Failed to update status', 'error');
            loadAgents();
        }
    }

    async function confirmDelete() {
        if (!pendingDelete) return;
        try {
            await apiFetch(`/api/agents/${pendingDelete.id}`, { method: 'DELETE' });
            showToast('Agent removed');
            loadAgents();
        } catch {
            showToast('Failed to remove agent', 'error');
        } finally {
            setPendingDelete(null);
        }
    }

    return (
        <div>
            <div className="panel">
                <div className="panel-header">
                    <h3>👥 Team</h3>
                    <button className="btn btn-primary" onClick={openAddForm}>+ Add Agent</button>
                </div>

                <p className="hint">
                    Only <strong>available</strong> agents are dialed when a caller presses the "speak to an agent"
                    option, in the order listed below.
                </p>

                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Email</th>
                            <th>Status</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {agents.length === 0 && (
                            <tr><td colSpan={5} className="empty">No agents yet — add your first one.</td></tr>
                        )}
                        {agents.map(agent => (
                            <tr key={agent.id}>
                                <td>{agent.name}</td>
                                <td>{agent.phone}</td>
                                <td>{agent.email || <span className="hint">unlinked</span>}</td>
                                <td>
                                    <button className="pill-toggle" onClick={() => toggleStatus(agent)}>
                                        <StatusPill value={agent.status} />
                                    </button>
                                </td>
                                <td className="row-actions">
                                    <button className="btn btn-link" onClick={() => openEditForm(agent)}>Edit</button>
                                    <button className="btn btn-link btn-link-danger" onClick={() => setPendingDelete(agent)}>Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
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
                            <tr key={s.agent}>
                                <td>{s.agent}</td>
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
                    <div className="modal" onClick={e => e.stopPropagation()}>
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
                            Email (optional — links their Google login for self-service status)
                            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="agent@chumz.io" />
                        </label>

                        {formError && <p className="error">{formError}</p>}

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={saveForm}>Save</button>
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
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />
        </div>
    );
}
