import { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider } from './lib/toast';
import Dashboard from './pages/Dashboard';
import Calls from './pages/Calls';
import Dialer from './pages/Dialer';
import Agents from './pages/Agents';
import IvrEditor from './pages/IvrEditor';

function Layout({ children }: { children: ReactNode }) {
    const { user, loading } = useAuth();

    return (
        <div className="app-shell">
            <header className="app-header">
                <h1>💚 Chumz Support</h1>
                <nav>
                    <NavLink to="/" end>Dashboard</NavLink>
                    <NavLink to="/calls">Calls</NavLink>
                    <NavLink to="/dialer">Dialer</NavLink>
                    <NavLink to="/agents">Agents</NavLink>
                    <NavLink to="/ivr">IVR</NavLink>
                </nav>
                <div className="app-header-right">
                    {!loading && user && <span className="user-email">{user.email}</span>}
                    <a href="/logout" className="logout-link">Logout</a>
                </div>
            </header>
            <main className="app-main">{children}</main>
        </div>
    );
}

export default function App() {
    return (
        <ToastProvider>
            <AuthProvider>
                <BrowserRouter basename="/app">
                    <Layout>
                        <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/calls" element={<Calls />} />
                            <Route path="/dialer" element={<Dialer />} />
                            <Route path="/agents" element={<Agents />} />
                            <Route path="/ivr" element={<IvrEditor />} />
                        </Routes>
                    </Layout>
                </BrowserRouter>
            </AuthProvider>
        </ToastProvider>
    );
}
