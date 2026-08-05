import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';

function initials(name: string) {
    return name
        .split(' ')
        .map(w => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

export default function Sidebar() {
    const { user, isSupervisor } = useAuth();

    const { data: queueData } = useQuery({
        queryKey: ['queue'],
        queryFn: () => apiFetch('/api/queue'),
        refetchInterval: 5000
    });

    const inQueue = queueData?.stats?.inQueue ?? 0;

    return (
        <aside className="sidebar">
            <div className="sidebar-logo">
                <div className="logo-mark">C</div>
                <span>Chumz</span>
            </div>

            <nav className="sidebar-nav">
                <NavLink to="/" end className="sidebar-link">
                    Dashboard
                </NavLink>
                <NavLink to="/queue" className="sidebar-link">
                    Live Queue
                    {inQueue > 0 && <span className="sidebar-badge">{inQueue}</span>}
                </NavLink>
                <NavLink to="/outbound" className="sidebar-link">
                    Outbound &amp; Missed
                </NavLink>
                <NavLink to="/tickets" className="sidebar-link">
                    Tags &amp; Tickets
                </NavLink>
                {isSupervisor && (
                    <>
                        <NavLink to="/agents" className="sidebar-link">
                            Agents
                        </NavLink>
                        <NavLink to="/ivr" className="sidebar-link">
                            IVR Builder
                        </NavLink>
                        <NavLink to="/forwarding" className="sidebar-link">
                            Call Forwarding
                        </NavLink>
                    </>
                )}
            </nav>

            {user && (
                <div className="sidebar-footer">
                    <div className="sidebar-avatar">{initials(user.name || user.email)}</div>
                    <div className="sidebar-user">
                        <div className="sidebar-user-name">{user.name || user.email}</div>
                        <div className="sidebar-user-role">{user.role === 'supervisor' ? 'Supervisor' : 'Agent'}</div>
                    </div>
                    <a href="/logout" title="Log out" className="sidebar-logout">
                        ⏻
                    </a>
                </div>
            )}
        </aside>
    );
}
