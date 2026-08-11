import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { useActiveCall } from '../../lib/activeCall';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import StatusDropdown from '../StatusDropdown';

type Status = 'available' | 'break' | 'offline';

const OPTIONS: Status[] = ['available', 'break', 'offline'];

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
        <StatusDropdown
            value={agentStatus ?? 'offline'}
            options={OPTIONS}
            disabled={setStatus.isPending || isSystemManaged}
            title={isSystemManaged ? "You're on a call — status updates automatically" : 'Change your status'}
            onChange={status => setStatus.mutate(status as Status)}
        />
    );
}
