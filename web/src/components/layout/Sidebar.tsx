import { NavLink } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

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
                <NavLink to="/calls" className="sidebar-link">
                    Calls
                </NavLink>
                {isSupervisor && (
                    <>
                        <NavLink to="/agents" className="sidebar-link">
                            Agents
                        </NavLink>
                        <NavLink to="/ivr" className="sidebar-link">
                            IVR Builder
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
