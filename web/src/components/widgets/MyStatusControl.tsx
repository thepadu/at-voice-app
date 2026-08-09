import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { useActiveCall } from '../../lib/activeCall';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import StatusPill from '../StatusPill';

type Status = 'available' | 'break' | 'offline';

// Available → Break → Offline → Available, same cycle already used on the
// supervisor's roster page — this is the same control, just self-service,
// so a plain agent doesn't need a supervisor to flip their own status.
// on_call/ringing are system-managed and not click-targets here.
function nextStatus(current: string | null): Status {
    if (current === 'available') return 'break';
    if (current === 'break') return 'offline';
    return 'available';
}

export default function MyStatusControl() {
    const { user } = useAuth();
    const { agentStatus } = useActiveCall();
    const queryClient = useQueryClient();
    const showToast = useToast();

    const setStatus = useMutation({
        mutationFn: (status: Status) => apiFetch('/api/agents/me/status', { method: 'PATCH', body: JSON.stringify({ status }) }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['active-call'] }),
        onError: (err: unknown) => showToast(err instanceof Error ? err.message : 'Failed to update status', 'error')
    });

    // No linked agent record (e.g. a supervisor-only account) — nothing to toggle.
    if (!user?.agentId) return null;

    const isSystemManaged = agentStatus === 'on_call' || agentStatus === 'ringing';

    return (
        <button
            className="pill-toggle my-status-control"
            onClick={() => !isSystemManaged && setStatus.mutate(nextStatus(agentStatus))}
            disabled={setStatus.isPending || isSystemManaged}
            title={isSystemManaged ? "You're on a call — status updates automatically" : 'Click to change your status'}
        >
            <StatusPill value={agentStatus ?? 'offline'} />
        </button>
    );
}
