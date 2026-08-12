import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useActiveCall } from '../../lib/activeCall';
import { useSoftphone } from '../../lib/softphone';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatPhone, isValidPhone } from '../../lib/phoneFormat';

function formatDuration(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

const ADD_PARTY_LABELS: Record<string, string> = {
    requested: 'Adding party…',
    dialing: 'Adding party…',
    connected: 'Party connected',
    left: 'Party left',
    failed: "Couldn't add party"
};

export default function StatusBar() {
    const { activeCall: polledCall, openQuickTicket } = useActiveCall();
    const { activeCall: softphoneCall, toggleMute, toggleHold, hangup } = useSoftphone();
    const [seconds, setSeconds] = useState(0);
    const [addPartyOpen, setAddPartyOpen] = useState(false);
    const [addPartyInput, setAddPartyInput] = useState('');
    const showToast = useToast();
    const queryClient = useQueryClient();

    const addParty = useMutation({
        mutationFn: (destination: string) =>
            apiFetch('/api/calls/active/add-party', { method: 'POST', body: JSON.stringify({ destination }) }),
        onSuccess: () => {
            setAddPartyInput('');
            setAddPartyOpen(false);
            queryClient.invalidateQueries({ queryKey: ['active-call'] });
        },
        onError: (err: unknown) => showToast(err instanceof Error ? err.message : 'Failed to add party', 'error')
    });

    function submitAddParty() {
        const phone = formatPhone(addPartyInput);
        if (!isValidPhone(phone)) {
            showToast('Enter a valid Kenyan number', 'error');
            return;
        }
        addParty.mutate(`+${phone}`);
    }

    // SIP.js's own session is the source of truth for anything the browser
    // directly witnesses in real time (this bar's render condition, mute,
    // hold) — the 5s Supabase poll stays authoritative for things only the
    // server knows (wrap-up/ticket triggers), so the two don't fight over
    // the same state. Falling back to the polled call keeps the bar visible
    // during the brief gap right after answering, before the local SIP.js
    // session has finished transitioning to Established.
    const caller = softphoneCall?.remoteNumber ?? polledCall?.caller;
    const startedAt = softphoneCall?.startedAt ?? (polledCall ? new Date(polledCall.created_at).getTime() : null);

    useEffect(() => {
        if (!startedAt) return;
        const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [startedAt]);

    if (!caller) return null;

    const addPartyStatus = polledCall?.add_party_status;
    const addPartyBusy = addPartyStatus === 'requested' || addPartyStatus === 'dialing';

    return (
        <div className="status-bar">
            <div className="status-bar-info">
                <span className="status-bar-dot" />
                On call with <strong>{caller}</strong>
                <span className="status-bar-timer">{formatDuration(seconds)}</span>
                {addPartyStatus && (
                    <span className={`status-bar-add-party ${addPartyStatus === 'failed' ? 'status-bar-add-party-failed' : ''}`}>
                        {ADD_PARTY_LABELS[addPartyStatus]}
                    </span>
                )}
            </div>
            <div className="status-bar-actions">
                {softphoneCall && (
                    <>
                        {addPartyOpen && (
                            <input
                                autoFocus
                                value={addPartyInput}
                                onChange={e => setAddPartyInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') submitAddParty();
                                    if (e.key === 'Escape') setAddPartyOpen(false);
                                }}
                                placeholder="Number to add"
                                className="status-bar-add-party-input"
                            />
                        )}
                        <button
                            className="btn status-bar-control-btn"
                            onClick={() => (addPartyOpen ? submitAddParty() : setAddPartyOpen(true))}
                            disabled={addParty.isPending || addPartyBusy}
                            title="Add a party to this call — merges straight in once they answer"
                        >
                            {addPartyOpen ? 'Dial' : '+ Party'}
                        </button>
                        <button
                            className={`btn status-bar-control-btn ${softphoneCall.muted ? 'status-bar-control-active' : ''}`}
                            onClick={toggleMute}
                        >
                            {softphoneCall.muted ? 'Unmute' : 'Mute'}
                        </button>
                        <button
                            className={`btn status-bar-control-btn ${softphoneCall.held ? 'status-bar-control-active' : ''}`}
                            onClick={toggleHold}
                            title={softphoneCall.held ? 'They currently hear silence' : "They'll hear silence, not hold music"}
                        >
                            {softphoneCall.held ? 'Resume' : 'Hold'}
                        </button>
                        <button className="btn status-bar-end-btn" onClick={hangup}>
                            End call
                        </button>
                    </>
                )}
                <button className="btn status-bar-ticket-btn" onClick={openQuickTicket}>
                    + Ticket
                </button>
            </div>
        </div>
    );
}
