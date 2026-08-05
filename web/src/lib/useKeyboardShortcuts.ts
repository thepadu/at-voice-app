import { useEffect } from 'react';
import { useActiveCall } from './activeCall';

// T = ticket the active call, E = open wrap-up early. No "A" (answer) —
// accepting a call is a phone action here, not a browser one (see
// SYSTEM_DESIGN.md), so there's nothing for a shortcut to trigger.
export function useKeyboardShortcuts() {
    const { activeCall, openQuickTicket, triggerWrapUp } = useActiveCall();

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            const tag = (document.activeElement as HTMLElement | null)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (!activeCall) return;

            const key = e.key.toLowerCase();
            if (key === 't') openQuickTicket();
            else if (key === 'e') triggerWrapUp();
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeCall, openQuickTicket, triggerWrapUp]);
}
