import { Suspense, lazy, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AuthProvider, useAuth } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import Layout from './components/layout/Layout';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Calls = lazy(() => import('./pages/Calls'));
const Agents = lazy(() => import('./pages/Agents'));
const IvrEditor = lazy(() => import('./pages/IvrEditor'));

function RequireSupervisor({ children }: { children: ReactNode }) {
    const { user, loading, isSupervisor } = useAuth();

    if (loading) return null;
    if (!isSupervisor) {
        return (
            <div className="panel">
                <h3>Supervisors only</h3>
                <p className="hint">
                    {user ? `Signed in as ${user.email}, role: agent.` : 'Not signed in.'} This page needs
                    supervisor access.
                </p>
            </div>
        );
    }

    return <>{children}</>;
}

function AppRoutes() {
    return (
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/calls" element={<Calls />} />
                <Route
                    path="/agents"
                    element={
                        <RequireSupervisor>
                            <Agents />
                        </RequireSupervisor>
                    }
                />
                <Route
                    path="/ivr"
                    element={
                        <RequireSupervisor>
                            <IvrEditor />
                        </RequireSupervisor>
                    }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Suspense>
    );
}

export default function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <ToastProvider>
                    <AuthProvider>
                        <BrowserRouter basename="/app">
                            <Layout>
                                <AppRoutes />
                            </Layout>
                        </BrowserRouter>
                    </AuthProvider>
                </ToastProvider>
            </ThemeProvider>
        </QueryClientProvider>
    );
}
