import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Info } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useSoftphone } from '../lib/softphone';
import StatusPill from '../components/StatusPill';
import Pagination from '../components/Pagination';
import CallDetailsDrawer from '../components/CallDetailsDrawer';

type Call = {
    session_id: string;
    caller: string;
    status: string | null;
    duration: number | null;
    created_at: string;
    agent_name?: string | null;
    called_back?: boolean;
    direction?: 'incoming' | 'outgoing';
    missed?: boolean;
    rating?: number | null;
};

type Tab = 'all' | 'incoming' | 'outgoing' | 'missed';
const TABS: { value: Tab; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'incoming', label: 'Incoming' },
    { value: 'outgoing', label: 'Outgoing' },
    { value: 'missed', label: 'Missed' }
];

function DirectionIcon({ call }: { call: Call }) {
    if (call.missed) return <PhoneMissed size={16} className="direction-icon direction-icon-missed" aria-label="Missed" />;
    if (call.direction === 'outgoing') return <PhoneOutgoing size={16} className="direction-icon direction-icon-outgoing" aria-label="Outgoing" />;
    return <PhoneIncoming size={16} className="direction-icon direction-icon-incoming" aria-label="Incoming" />;
}

function DetailsButton({ onOpen }: { onOpen: () => void }) {
    return (
        <button className="btn-icon" onClick={onOpen} title="View details" aria-label="View details">
            <Info size={16} />
        </button>
    );
}

const PAGE_SIZE = 25;

function missedReason(status: string | null) {
    if (status === 'forwarded') return 'Forwarded (nobody online)';
    if (status === 'after_hours') return 'Outside business hours';
    return 'Abandoned';
}

// The table above already scrolls horizontally on a phone (styles.css's
// mobile table rules), but that's a "works, not delightful" fallback for a
// 6-column layout on a 375px screen — this is the same data reshaped into a
// stacked call-log card, the way a phone's native recents list looks. Shown
// only below the 880px breakpoint (styles.css), the table only above it —
// same underlying `calls` array, no tab-specific logic needed since every
// tab already shares this exact column shape.
function CallCard({ call, onOpenDetails, onCallBack }: { call: Call; onOpenDetails: () => void; onCallBack: (caller: string) => void }) {
    return (
        <div className="call-card">
            <div className="call-card-top">
                <DirectionIcon call={call} />
                <span className="call-card-caller">{call.caller}</span>
                <StatusPill value={call.status ?? 'unknown'} />
            </div>
            <div className="call-card-meta">
                <span>{call.agent_name ?? '—'}</span>
                <span>{new Date(call.created_at).toLocaleString()}</span>
            </div>
            {call.direction === 'outgoing' && <div className="calls-row-caption">{call.duration ?? 0}s</div>}
            {call.missed && <div className="calls-row-caption">{missedReason(call.status)}</div>}
            <div className="call-card-actions">
                {call.missed && (
                    <button
                        className={call.called_back ? 'btn btn-callback-done' : 'btn btn-primary'}
                        onClick={() => onCallBack(call.caller)}
                        title={call.called_back ? 'Already called back — click to call again' : undefined}
                    >
                        {call.called_back ? '✓ Called back' : 'Call back'}
                    </button>
                )}
                <DetailsButton onOpen={onOpenDetails} />
            </div>
        </div>
    );
}

export default function Calls() {
    const [tab, setTab] = useState<Tab>('all');
    const [page, setPage] = useState(1);
    const [detailsCall, setDetailsCall] = useState<Call | null>(null);
    const { placeCall } = useSoftphone();

    const [draftFrom, setDraftFrom] = useState('');
    const [draftTo, setDraftTo] = useState('');
    const [draftCaller, setDraftCaller] = useState('');
    const [filters, setFilters] = useState({ from: '', to: '', caller: '' });

    function changeTab(next: Tab) {
        setTab(next);
        setPage(1);
    }

    function applyFilters() {
        setFilters({ from: draftFrom, to: draftTo, caller: draftCaller.trim() });
        setPage(1);
    }

    function clearFilters() {
        setDraftFrom('');
        setDraftTo('');
        setDraftCaller('');
        setFilters({ from: '', to: '', caller: '' });
        setPage(1);
    }

    const filtersActive = !!(filters.from || filters.to || filters.caller);

    const params = new URLSearchParams({ tab, page: String(page), pageSize: String(PAGE_SIZE) });
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.caller) params.set('caller', filters.caller);

    const { data, isLoading } = useQuery({
        queryKey: ['calls', tab, page, filters],
        queryFn: () => apiFetch(`/api/calls?${params.toString()}`)
    });

    const calls: Call[] = data?.calls ?? [];
    const total: number = data?.total ?? 0;
    const totalPages: number = data?.totalPages ?? 1;

    const EMPTY_NOUN: Record<Tab, string> = { all: 'calls', incoming: 'incoming calls', outgoing: 'outgoing calls', missed: 'missed calls' };
    const emptyMessage = `No ${EMPTY_NOUN[tab]}${filtersActive ? ' match these filters.' : tab === 'missed' ? ' outstanding.' : ' yet.'}`;

    // Routed through the same browser softphone as the dialer (placeCall
    // already handles its own "not registered" / "already on a call" /
    // failure feedback via toasts, and the outgoing-call banner covers the
    // "calling…" state) — this used to hit the old Africa's Talking /call
    // endpoint, a leftover from before outbound calling moved to Asterisk.
    function callBack(caller: string) {
        placeCall(`+${caller}`);
    }

    return (
        <div>
            <div className="tabs">
                {TABS.map(t => (
                    <button key={t.value} className={tab === t.value ? 'tab active' : 'tab'} onClick={() => changeTab(t.value)}>
                        {t.label}
                        {tab === t.value && ` (${total})`}
                    </button>
                ))}
            </div>

            <div className="panel calls-filters">
                <label>
                    From
                    <input type="date" value={draftFrom} onChange={e => setDraftFrom(e.target.value)} />
                </label>
                <label>
                    To
                    <input type="date" value={draftTo} onChange={e => setDraftTo(e.target.value)} />
                </label>
                <label className="calls-filter-caller">
                    Caller number
                    <input
                        value={draftCaller}
                        onChange={e => setDraftCaller(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && applyFilters()}
                        placeholder="Search by number"
                    />
                </label>
                <div className="calls-filter-actions">
                    <button className="btn btn-primary" onClick={applyFilters}>Apply</button>
                    {filtersActive && (
                        <button className="btn btn-secondary" onClick={clearFilters}>Clear</button>
                    )}
                </div>
            </div>

            <div className="panel">
                <table className="calls-table">
                    <thead>
                        <tr>
                            <th></th>
                            <th>Caller / Number</th>
                            <th>Agent</th>
                            <th>Status</th>
                            <th>Time</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && (
                            <tr><td colSpan={6} className="empty">Loading…</td></tr>
                        )}
                        {!isLoading && calls.length === 0 && (
                            <tr><td colSpan={6} className="empty">{emptyMessage}</td></tr>
                        )}
                        {calls.map(call => (
                            <tr key={call.session_id}>
                                <td><DirectionIcon call={call} /></td>
                                <td>{call.caller}</td>
                                <td>{call.agent_name ?? '—'}</td>
                                <td>
                                    <StatusPill value={call.status ?? 'unknown'} />
                                    {call.missed && <div className="calls-row-caption">{missedReason(call.status)}</div>}
                                </td>
                                <td>
                                    {new Date(call.created_at).toLocaleString()}
                                    {call.direction === 'outgoing' && <div className="calls-row-caption">{call.duration ?? 0}s</div>}
                                </td>
                                <td className="calls-row-actions">
                                    {call.missed && (
                                        <button
                                            className={call.called_back ? 'btn btn-callback-done' : 'btn btn-primary'}
                                            onClick={() => callBack(call.caller)}
                                            title={call.called_back ? 'Already called back — click to call again' : undefined}
                                        >
                                            {call.called_back ? '✓ Called back' : 'Call back'}
                                        </button>
                                    )}
                                    <DetailsButton onOpen={() => setDetailsCall(call)} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="calls-mobile-list">
                    {isLoading && <p className="empty">Loading…</p>}
                    {!isLoading && calls.length === 0 && <p className="empty">{emptyMessage}</p>}
                    {calls.map(call => (
                        <CallCard key={call.session_id} call={call} onOpenDetails={() => setDetailsCall(call)} onCallBack={callBack} />
                    ))}
                </div>

                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>

            <CallDetailsDrawer call={detailsCall} onClose={() => setDetailsCall(null)} />
        </div>
    );
}
