import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';
import ConfirmDialog from '../components/ConfirmDialog';

type Rule = { id: number; condition: string; destination: string };

const CONDITIONS: { value: string; label: string }[] = [
    { value: 'no_answer', label: 'No answer' },
    { value: 'busy', label: 'Line busy' },
    { value: 'always', label: 'Always' },
    { value: 'after_hours', label: 'After hours' }
];

function errorMessage(err: unknown) {
    return err instanceof Error ? err.message : 'Something went wrong';
}

export default function CallForwarding() {
    const queryClient = useQueryClient();
    const showToast = useToast();

    const { data: configData } = useQuery({ queryKey: ['forwarding-config'], queryFn: () => apiFetch('/api/forwarding-config') });
    const { data: rulesData } = useQuery({ queryKey: ['forwarding-rules'], queryFn: () => apiFetch('/api/forwarding-rules') });

    const rules: Rule[] = rulesData?.rules ?? [];

    const [newCondition, setNewCondition] = useState('no_answer');
    const [newDestination, setNewDestination] = useState('');
    const [pendingDelete, setPendingDelete] = useState<Rule | null>(null);

    const toggleEnabled = useMutation({
        mutationFn: (enabled: boolean) => apiFetch('/api/forwarding-config', { method: 'PATCH', body: JSON.stringify({ enabled }) }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['forwarding-config'] }),
        onError: (err: unknown) => showToast(errorMessage(err), 'error')
    });

    const addRule = useMutation({
        mutationFn: () =>
            apiFetch('/api/forwarding-rules', {
                method: 'POST',
                body: JSON.stringify({ condition: newCondition, destination: newDestination })
            }),
        onSuccess: () => {
            setNewDestination('');
            queryClient.invalidateQueries({ queryKey: ['forwarding-rules'] });
        },
        onError: (err: unknown) => showToast(errorMessage(err), 'error')
    });

    const deleteRule = useMutation({
        mutationFn: (id: number) => apiFetch(`/api/forwarding-rules/${id}`, { method: 'DELETE' }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['forwarding-rules'] }),
        onSettled: () => setPendingDelete(null)
    });

    return (
        <div style={{ maxWidth: 720 }}>
            <div className="panel panel-header">
                <div>
                    <h3 style={{ marginBottom: 2 }}>Call forwarding</h3>
                    <p className="hint" style={{ marginBottom: 0 }}>Route calls elsewhere based on the rules below.</p>
                </div>
                <label className="toggle-switch">
                    <input
                        type="checkbox"
                        checked={!!configData?.enabled}
                        onChange={e => toggleEnabled.mutate(e.target.checked)}
                    />
                    <span className="toggle-track"><span className="toggle-knob" /></span>
                </label>
            </div>

            <div className="panel">
                <div className="panel-header">
                    <h3>Rules</h3>
                </div>
                <p className="hint">
                    Not yet wired into live call routing — Africa's Talking's hold queue has no documented
                    way for our server to reach into an already-waiting call and redirect it, so these
                    rules are saved but not automatically triggered yet. See SYSTEM_DESIGN.md.
                </p>

                {rules.map(rule => (
                    <div className="forwarding-rule-row" key={rule.id}>
                        <span>{CONDITIONS.find(c => c.value === rule.condition)?.label ?? rule.condition}</span>
                        <span className="hint" style={{ margin: 0 }}>→</span>
                        <span>{rule.destination}</span>
                        <button className="btn btn-link btn-link-danger" onClick={() => setPendingDelete(rule)}>Remove</button>
                    </div>
                ))}

                <div className="forwarding-add-row">
                    <select value={newCondition} onChange={e => setNewCondition(e.target.value)}>
                        {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <input
                        value={newDestination}
                        onChange={e => setNewDestination(e.target.value)}
                        placeholder="Agent, queue name, or number"
                    />
                    <button className="btn btn-primary" onClick={() => addRule.mutate()} disabled={!newDestination.trim() || addRule.isPending}>
                        + Add rule
                    </button>
                </div>
            </div>

            <ConfirmDialog
                open={!!pendingDelete}
                title="Remove forwarding rule"
                message={`Remove the "${pendingDelete?.condition}" rule?`}
                confirmLabel="Remove"
                danger
                onConfirm={() => pendingDelete && deleteRule.mutate(pendingDelete.id)}
                onCancel={() => setPendingDelete(null)}
            />
        </div>
    );
}
