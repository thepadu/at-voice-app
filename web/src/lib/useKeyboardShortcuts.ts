import { useEffect } from 'react';
import { useActiveCall } from './activeCall';
import { useSoftphone } from './softphone';

// T = ticket the active call, E = open wrap-up early, A = answer a ringing
// browser call — now a legitimate browser action since the softphone is a
// real WebRTC endpoint, not just a phone-based accept flow.
export function useKeyboardShortcuts() {
    const { activeCall, openQuickTicket, triggerWrapUp } = useActiveCall();
    const { incomingCall, answer } = useSoftphone();

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            const tag = (document.activeElement as HTMLElement | null)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            const key = e.key.toLowerCase();
            if (key === 'a' && incomingCall) {
                answer();
                return;
            }
            if (!activeCall) return;
            if (key === 't') openQuickTicket();
            else if (key === 'e') triggerWrapUp();
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeCall, incomingCall, answer, openQuickTicket, triggerWrapUp]);
}
