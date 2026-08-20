import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch, ApiError } from './api';

type Role = 'agent' | 'supervisor';
type User = { email: string; name: string; role: Role; agentId: number | null };

const AuthContext = createContext<{ user: User | null; loading: boolean; isSupervisor: boolean; checkFailed: boolean }>({
    user: null,
    loading: true,
    isSupervisor: false,
    checkFailed: false
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    // A genuine "not logged in" (401) already redirects to /login inside
    // apiFetch itself before this ever resolves — reaching this catch means
    // the check itself failed (network down, a 500), not that the session
    // is actually absent. Worth telling those two apart: "you're not signed
    // in" is the wrong thing to tell a supervisor whose session is fine but
    // whose one /api/me request happened to hit a bad moment.
    const [checkFailed, setCheckFailed] = useState(false);

    useEffect(() => {
        apiFetch('/api/me')
            .then(data => setUser(data.user))
            .catch((err: unknown) => {
                setUser(null);
                if (!(err instanceof ApiError && err.status === 401)) setCheckFailed(true);
            })
            .finally(() => setLoading(false));
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, isSupervisor: user?.role === 'supervisor', checkFailed }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
