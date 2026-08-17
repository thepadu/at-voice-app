import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { useActiveCall } from '../../lib/activeCall';
import { useToast } from '../../lib/toast';
import { useModalA11y } from '../../lib/useModalA11y';

const DISPOSITIONS = ['Resolved', 'Escalated', 'Follow-up needed', 'No resolution'];

export default function WrapUpModal() {
    const { justEnded, lastCall, dismissJustEnded } = useActiveCall();
    const [disposition, setDisposition] = useState('Resolved');
    const showToast = useToast();

    // Same reasoning as TicketDrawer's reset — this modal stays mounted
    // between calls, so a disposition picked (or left) for one call would
    // otherwise still be selected by default for the next one.
    useEffect(() => {
        setDisposition('Resolved');
    }, [lastCall?.session_id]);

    const finish = useMutation({
        mutationFn: () =>
            apiFetch('/api/tickets', {
                method: 'POST',
                body: JSON.stringify({
                    session_id: lastCall?.session_id,
                    caller_number: lastCall?.caller,
                    priority: 'Medium',
                    status: disposition,
                    notes: `Logged from call wrap-up.`
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
                            onClick={() => setDisposition(d)}
                        >
                            {d}
                        </button>
                    ))}
                </div>

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={dismissJustEnded}>Back to call</button>
                    <button className="btn btn-primary" onClick={() => finish.mutate()} disabled={finish.isPending}>
                        Finish &amp; log call
                    </button>
                </div>
            </div>
        </div>
    );
}
