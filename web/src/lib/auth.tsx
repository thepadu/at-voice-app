import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch } from './api';

type User = { email: string; name: string };

const AuthContext = createContext<{ user: User | null; loading: boolean }>({
    user: null,
    loading: true
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

    return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    return useContext(AuthContext);
}
