import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch } from './api';

type Role = 'agent' | 'supervisor';
type User = { email: string; name: string; role: Role; agentId: number | null };

const AuthContext = createContext<{ user: User | null; loading: boolean; isSupervisor: boolean }>({
    user: null,
    loading: true,
    isSupervisor: false
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch('/api/me')
            .then(data => setUser(data.user))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, isSupervisor: user?.role === 'supervisor' }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
