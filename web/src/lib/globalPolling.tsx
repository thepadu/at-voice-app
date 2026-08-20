import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

// Single, explicit owner of the two intervals that keep the queue badge
// (Sidebar), the "agents live" count (Topbar), and the Live Queue page
// all fresh. Those three all read the exact same React Query cache
// entries via a plain useQuery with no refetchInterval of their own — this
// component is the only thing actually re-fetching either one.
//
// Before this existed, the intervals lived directly on whichever UI
// component happened to need the data first (Sidebar for ['queue'],
// Topbar for ['agents-available-count']), and LiveQueue.tsx piggybacked on
// both without owning either — correct today only because Layout always
// mounts Sidebar and Topbar on every route, but silently fragile: nothing
// stopped a future Sidebar/Topbar refactor from dropping a refetchInterval
// it looked like nobody needed, quietly breaking LiveQueue's live updates
// with no compiler error anywhere. Mounted once, always, in Layout — same
// guarantee as before, just with one findable name instead of two
// incidental ones.
export default function GlobalPolling() {
    useQuery({
        queryKey: ['queue'],
        queryFn: () => apiFetch('/api/queue'),
        refetchInterval: 5000
    });

    useQuery({
        queryKey: ['agents-available-count'],
        queryFn: () => apiFetch('/api/agents/available-count'),
        refetchInterval: 15000
    });

    return null;
}
