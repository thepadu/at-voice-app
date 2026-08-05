import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

type Call = { session_id: string; caller: string; created_at: string };

const ActiveCallContext = createContext<{
    activeCall: Call | null;
    lastCall: Call | null;
    justEnded: boolean;
    dismissJustEnded: () => void;
    triggerWrapUp: () => void;
    quickTicketOpen: boolean;
    openQuickTicket: () => void;
    closeQuickTicket: () => void;
}>({
    activeCall: null,
    lastCall: null,
    justEnded: false,
    dismissJustEnded: () => {},
    triggerWrapUp: () => {},
    quickTicketOpen: false,
    openQuickTicket: () => {},
    closeQuickTicket: () => {}
});

// Polls the logged-in agent's own call status. There's no way to push this
// from the server without real-time infra (see SYSTEM_DESIGN.md's
// scalability notes), so this is a plain 5s poll like everything else.
export function ActiveCallProvider({ children }: { children: ReactNode }) {
    const { data } = useQuery({
        queryKey: ['active-call'],
        queryFn: () => apiFetch('/api/agents/me/active-call'),
        refetchInterval: 5000
    });

    const [justEnded, setJustEnded] = useState(false);
    const [lastCall, setLastCall] = useState<Call | null>(null);
    const [quickTicketOpen, setQuickTicketOpen] = useState(false);
    const wasOnCall = useRef(false);

    const activeCall: Call | null = data?.call ?? null;
    const isOnCall = data?.agentStatus === 'on_call';

    useEffect(() => {
        if (activeCall) setLastCall(activeCall);
    }, [activeCall]);

    useEffect(() => {
        if (wasOnCall.current && !isOnCall) setJustEnded(true);
        wasOnCall.current = isOnCall;
    }, [isOnCall]);

    return (
        <ActiveCallContext.Provider
            value={{
                activeCall,
                lastCall,
                justEnded,
                dismissJustEnded: () => setJustEnded(false),
                // Lets the "E" keyboard shortcut open wrap-up early, before
                // the natural on_call → available transition is detected.
                triggerWrapUp: () => setJustEnded(true),
                quickTicketOpen,
                openQuickTicket: () => setQuickTicketOpen(true),
                closeQuickTicket: () => setQuickTicketOpen(false)
            }}
        >
            {children}
        </ActiveCallContext.Provider>
    );
}

export function useActiveCall() {
    return useContext(ActiveCallContext);
}
