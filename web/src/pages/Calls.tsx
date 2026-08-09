import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';
import StatusPill from '../components/StatusPill';
import Pagination from '../components/Pagination';

type Call = {
    session_id: string;
    caller: string;
    status: string | null;
    duration: number | null;
    created_at: string;
    agent_name?: string | null;
};

type Tab = 'incoming' | 'outgoing' | 'missed';
const TABS: { value: Tab; label: string }[] = [
    { value: 'incoming', label: 'Incoming' },
    { value: 'outgoing', label: 'Outbound' },
    { value: 'missed', label: 'Missed' }
];

const PAGE_SIZE = 25;

function answeredLabel(status: string | null) {
    if (status === 'completed') return '✅ Answered';
    if (status === 'failed') return '❌ Not answered';
    return '—';
}

function missedReason(status: string | null) {
    if (status === 'forwarded') return 'Forwarded (nobody online)';
    if (status === 'after_hours') return 'Outside business hours';
    return 'Abandoned';
}

export default function Calls() {
    const [tab, setTab] = useState<Tab>('incoming');
    const [page, setPage] = useState(1);
    const showToast = useToast();

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

    const { data } = useQuery({
        queryKey: ['calls', tab, page, filters],
        queryFn: () => apiFetch(`/api/calls?${params.toString()}`)
    });

    const calls: Call[] = data?.calls ?? [];
    const total: number = data?.total ?? 0;
    const totalPages: number = data?.totalPages ?? 1;

    async function callBack(caller: string) {
        try {
            await apiFetch('/call', { method: 'POST', body: JSON.stringify({ phone: caller }) });
            showToast(`📞 Calling ${caller} back`);
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Call failed', 'error');
        }
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

            {tab === 'incoming' && (
                <div className="panel">
                    <table>
                        <thead>
                            <tr>
                                <th>Caller</th>
                                <th>Agent</th>
                                <th>Status</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {calls.length === 0 && (
                                <tr><td colSpan={4} className="empty">No incoming calls{filtersActive ? ' match these filters.' : ' yet.'}</td></tr>
                            )}
                            {calls.map(call => (
                                <tr key={call.session_id}>
                                    <td>{call.caller}</td>
                                    <td>{call.agent_name ?? '—'}</td>
                                    <td><StatusPill value={call.status ?? 'unknown'} /></td>
                                    <td>{new Date(call.created_at).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                </div>
            )}

            {tab === 'outgoing' && (
                <div className="panel">
                    <table>
                        <thead>
                            <tr>
                                <th>Number</th>
                                <th>Agent</th>
                                <th>Duration</th>
                                <th>Answered</th>
                                <th>Outcome</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {calls.length === 0 && (
                                <tr><td colSpan={6} className="empty">No outbound calls{filtersActive ? ' match these filters.' : ' yet.'}</td></tr>
                            )}
                            {calls.map(call => (
                                <tr key={call.session_id}>
                                    <td>{call.caller}</td>
                                    <td>{call.agent_name ?? '—'}</td>
                                    <td>{call.duration ?? 0}s</td>
                                    <td>{answeredLabel(call.status)}</td>
                                    <td><StatusPill value={call.status ?? 'unknown'} /></td>
                                    <td>{new Date(call.created_at).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                </div>
            )}

            {tab === 'missed' && (
                <div className="panel">
                    <table>
                        <thead>
                            <tr>
                                <th>Caller</th>
                                <th>Reason</th>
                                <th>Time</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {calls.length === 0 && (
                                <tr><td colSpan={4} className="empty">No missed calls{filtersActive ? ' match these filters.' : ' outstanding.'}</td></tr>
                            )}
                            {calls.map(call => (
                                <tr key={call.session_id}>
                                    <td>{call.caller}</td>
                                    <td>{missedReason(call.status)}</td>
                                    <td>{new Date(call.created_at).toLocaleString()}</td>
                                    <td>
                                        <button className="btn btn-primary" onClick={() => callBack(call.caller)}>
                                            Call back
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                </div>
            )}
        </div>
    );
}
