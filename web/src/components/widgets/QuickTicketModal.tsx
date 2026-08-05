import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { useActiveCall } from '../../lib/activeCall';
import { useToast } from '../../lib/toast';
import { useModalA11y } from '../../lib/useModalA11y';

type Agent = { id: number; name: string };

function errorMessage(err: unknown) {
    return err instanceof Error ? err.message : 'Something went wrong';
}

export default function QuickTicketModal() {
    const { quickTicketOpen, closeQuickTicket, activeCall, lastCall } = useActiveCall();
    const call = activeCall ?? lastCall;
    const showToast = useToast();

    const { data: tagsData } = useQuery({ queryKey: ['ticket-tags'], queryFn: () => apiFetch('/api/ticket-tags'), enabled: quickTicketOpen });
    const { data: agentsData } = useQuery({ queryKey: ['agents-assignable'], queryFn: () => apiFetch('/api/agents/assignable'), enabled: quickTicketOpen });

    const tags: string[] = tagsData?.tags ?? [];
    const agents: Agent[] = agentsData?.agents ?? [];

    const [tag, setTag] = useState('');
    const [priority, setPriority] = useState('Medium');
    const [assignedAgentId, setAssignedAgentId] = useState<number | ''>('');
    const [notes, setNotes] = useState('');

    const create = useMutation({
        mutationFn: () =>
            apiFetch('/api/tickets', {
                method: 'POST',
                body: JSON.stringify({
                    session_id: call?.session_id,
                    caller_number: call?.caller,
                    tag: tag || (tags[0] ?? null),
                    priority,
                    assigned_agent_id: assignedAgentId || null,
                    notes
                })
            }),
        onSuccess: () => {
            showToast('Ticket created');
            setTag('');
            setPriority('Medium');
            setAssignedAgentId('');
            setNotes('');
            closeQuickTicket();
        },
        onError: (err: unknown) => showToast(errorMessage(err), 'error')
    });

    const containerRef = useModalA11y(quickTicketOpen, closeQuickTicket);

    if (!quickTicketOpen || !call) return null;

    return (
        <div className="modal-overlay" onClick={closeQuickTicket}>
            <div ref={containerRef} className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                <h3>New ticket</h3>
                <p className="hint">For {call.caller}</p>

                <label>
                    Tag
                    <select value={tag} onChange={e => setTag(e.target.value)}>
                        <option value="">Select…</option>
                        {tags.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </label>
                <label>
                    Priority
                    <select value={priority} onChange={e => setPriority(e.target.value)}>
                        {['Low', 'Medium', 'High', 'Urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </label>
                <label>
                    Assign to agent
                    <select value={assignedAgentId} onChange={e => setAssignedAgentId(e.target.value ? Number(e.target.value) : '')}>
                        <option value="">Unassigned</option>
                        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                </label>
                <label>
                    Notes
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
                </label>

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={closeQuickTicket}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
                        Create ticket
                    </button>
                </div>
            </div>
        </div>
    );
}
