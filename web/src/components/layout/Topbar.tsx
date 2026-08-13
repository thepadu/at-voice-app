import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu, Search, Sun, Moon } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useTheme } from '../../lib/theme';
import MyStatusControl from '../widgets/MyStatusControl';

const TITLES: Record<string, string> = {
    '/': 'Dashboard',
    '/queue': 'Live Queue',
    '/calls': 'Calls',
    '/tickets': 'Tags & Tickets',
    '/analytics': 'Analytics',
    '/agents': 'Agents',
    '/ivr': 'IVR Builder',
    '/settings': 'Settings'
};

export default function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
    const location = useLocation();
    const { darkMode, toggleDarkMode } = useTheme();

    const { data } = useQuery({
        queryKey: ['agents-available-count'],
        queryFn: () => apiFetch('/api/agents/available-count'),
        refetchInterval: 15000
    });

    const title = TITLES[location.pathname] ?? 'Chumz Support';

    return (
        <header className="topbar">
            <div className="topbar-left">
                <button className="topbar-menu-btn" onClick={onMenuClick} aria-label="Open menu">
                    <Menu size={20} />
                </button>
                <div className="topbar-title">{title}</div>
            </div>
            <div className="topbar-right">
                <div className="topbar-search">
                    <span className="topbar-search-icon" aria-hidden="true">
                        <Search size={16} />
                    </span>
                    Search calls, agents…
                </div>
                <div className="topbar-badge">
                    <span className="topbar-badge-dot" />
                    {data?.count ?? '—'} agents live
                </div>
                <MyStatusControl />
                <button className="topbar-theme-toggle" onClick={toggleDarkMode} title="Toggle night shift theme" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {darkMode ? <><Sun size={16} /> Light</> : <><Moon size={16} /> Night shift</>}
                </button>
            </div>
        </header>
    );
}
