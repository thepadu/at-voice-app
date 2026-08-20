import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { useActiveCall } from '../../lib/activeCall';
import { useToast } from '../../lib/toast';
import { useModalA11y } from '../../lib/useModalA11y';
import { TICKET_PRIORITIES } from '../../lib/ticketStatus';

const DISPOSITIONS = ['Resolved', 'Escalated', 'Follow-up needed', 'No resolution'];

// A pick here is just a starting point the agent can override below — not
// a rule — but "Escalated"/"Follow-up needed" defaulting to the same
// Medium as "Resolved" meant a genuinely urgent call needed a second trip
// into the ticket later just to raise its own priority.
const DEFAULT_PRIORITY: Record<string, string> = {
    Resolved: 'Medium',
    Escalated: 'High',
    'Follow-up needed': 'Medium',
    'No resolution': 'Medium'
};

export default function WrapUpModal() {
    const { justEnded, lastCall, dismissJustEnded } = useActiveCall();
    const [disposition, setDisposition] = useState('Resolved');
    const [priority, setPriority] = useState(DEFAULT_PRIORITY.Resolved);
    const [notes, setNotes] = useState('Logged from call wrap-up.');
    const showToast = useToast();

    // Same reasoning as TicketDrawer's reset — this modal stays mounted
    // between calls, so a disposition/priority/note picked (or left) for
    // one call would otherwise still be sitting there for the next one.
    useEffect(() => {
        setDisposition('Resolved');
        setPriority(DEFAULT_PRIORITY.Resolved);
        setNotes('Logged from call wrap-up.');
    }, [lastCall?.session_id]);

    function pickDisposition(d: string) {
        setDisposition(d);
        setPriority(DEFAULT_PRIORITY[d] ?? 'Medium');
    }

    const finish = useMutation({
        mutationFn: () =>
            apiFetch('/api/tickets', {
                method: 'POST',
                body: JSON.stringify({
                    session_id: lastCall?.session_id,
                    caller_number: lastCall?.caller,
                    priority,
                    status: disposition,
                    notes
                })
            }),
        onSuccess: () => {
            showToast('Call logged');
            dismissJustEnded();
        },
        onError: () => showToast('Failed to log call', 'error')
    });

    const containerRef = useModalA11y(justEnded, dismissJustEnded);

    if (!justEnded || !lastCall) return null;

    return (
        <div className="modal-overlay" onClick={dismissJustEnded}>
            <div ref={containerRef} className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                <h3>Wrap up call</h3>
                <p className="hint">With {lastCall.caller}</p>

                <div className="disposition-chips">
                    {DISPOSITIONS.map(d => (
                        <button
                            key={d}
                            className={d === disposition ? 'chip chip-selected' : 'chip'}
                            onClick={() => pickDisposition(d)}
                        >
                            {d}
                        </button>
                    ))}
                </div>

                <label>
                    Priority
                    <select value={priority} onChange={e => setPriority(e.target.value)}>
                        {TICKET_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </label>

                <label>
                    Notes
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
                </label>

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={dismissJustEnded}>Dismiss</button>
                    <button className="btn btn-primary" onClick={() => finish.mutate()} disabled={finish.isPending}>
                        Finish &amp; log call
                    </button>
                </div>
            </div>
        </div>
    );
}
