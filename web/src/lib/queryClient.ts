import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // A stale query still refetches on window focus (React Query's
            // default) — good for a tool people tab back into mid-shift.
            retry: 1
        }
    }
});
