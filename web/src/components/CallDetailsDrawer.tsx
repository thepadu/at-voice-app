import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useModalA11y } from '../lib/useModalA11y';
import StatusPill from './StatusPill';

type Call = {
    session_id: string;
    caller: string;
    status: string | null;
    duration: number | null;
    created_at: string;
    agent_name?: string | null;
};

type Ticket = {
    id: number;
    tag: string | null;
    priority: string;
    status: string;
    notes: string | null;
    assigned_agent_name?: string | null;
    created_at: string;
};

// Tickets use a different (capitalized) status vocabulary than call_logs —
// kept separate from StatusPill's map rather than forcing a case-insensitive
// lookup there, since the two vocabularies aren't actually the same concept.
const TICKET_STATUS_COLORS: Record<string, string> = {
    Open: '#EF5350',
    'Follow-up needed': '#F39C12',
    Escalated: '#F39C12',
    Resolved: '#17A697',
    'No resolution': '#757575'
};

export default function CallDetailsDrawer({ call, onClose }: { call: Call | null; onClose: () => void }) {
    const containerRef = useModalA11y(!!call, onClose);

    const { data: ticketsData } = useQuery({
        queryKey: ['call-tickets', call?.session_id],
        queryFn: () => apiFetch(`/api/tickets?session_id=${call!.session_id}`),
        enabled: !!call
    });

    const { data: historyData } = useQuery({
        queryKey: ['call-history', call?.caller],
        queryFn: () => apiFetch(`/api/calls?tab=all&caller=${encodeURIComponent(call!.caller)}&pageSize=6`),
        enabled: !!call
    });

    if (!call) return null;

    const tickets: Ticket[] = ticketsData?.tickets ?? [];
    const history: Call[] = (historyData?.calls ?? []).filter((c: Call) => c.session_id !== call.session_id);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div ref={containerRef} className="modal modal-lg" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                <h3>Call details</h3>
                <p className="hint">
                    {call.caller} · {new Date(call.created_at).toLocaleString()}
                </p>

                <div className="call-details-summary">
                    <div>
                        <span className="call-details-label">Status</span>
                        <StatusPill value={call.status ?? 'unknown'} />
                    </div>
                    <div>
                        <span className="call-details-label">Agent</span>
                        {call.agent_name ?? '—'}
                    </div>
                    <div>
                        <span className="call-details-label">Duration</span>
                        {call.duration ?? 0}s
                    </div>
                </div>

                <h4>Tickets ({tickets.length})</h4>
                {tickets.length === 0 && <p className="empty">No tickets for this call.</p>}
                {tickets.map(t => (
                    <div key={t.id} className="call-details-ticket">
                        <div className="call-details-ticket-header">
                            <span className="status-pill" style={{ background: TICKET_STATUS_COLORS[t.status] ?? '#757575' }}>
                                {t.status}
                            </span>
                            <span className="hint">{t.priority} priority</span>
                            {t.tag && <span className="hint">· {t.tag}</span>}
                        </div>
                        {t.notes && <p className="hint">{t.notes}</p>}
                        <p className="hint">
                            {t.assigned_agent_name ? `Assigned to ${t.assigned_agent_name}` : 'Unassigned'} ·{' '}
                            {new Date(t.created_at).toLocaleString()}
                        </p>
                    </div>
                ))}

                <h4>History with this caller</h4>
                {history.length === 0 && <p className="empty">No other calls from this number.</p>}
                {history.slice(0, 5).map(h => (
                    <div key={h.session_id} className="call-details-history-row">
                        <StatusPill value={h.status ?? 'unknown'} />
                        <span>{new Date(h.created_at).toLocaleString()}</span>
                    </div>
                ))}

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
