import { ReactNode, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import StatusBar from '../widgets/StatusBar';
import IncomingCallBanner from '../widgets/IncomingCallBanner';
import OutgoingCallBanner from '../widgets/OutgoingCallBanner';
import WrapUpModal from '../widgets/WrapUpModal';
import QuickTicketModal from '../widgets/QuickTicketModal';
import FloatingDialer from '../widgets/FloatingDialer';
import LiveAnalyticsBadge from '../widgets/LiveAnalyticsBadge';
import { useKeyboardShortcuts } from '../../lib/useKeyboardShortcuts';

export default function Layout({ children }: { children: ReactNode }) {
    useKeyboardShortcuts();

    // The sidebar is always visible on desktop — this only matters below
    // the mobile breakpoint, where it becomes an off-canvas drawer (see
    // styles.css). Harmless to carry the state on desktop too rather than
    // conditionally render it, since the CSS ignores it above the breakpoint.
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <div className="app-shell">
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
            <IncomingCallBanner />
            <OutgoingCallBanner />
            <div className="app-shell-main">
                <Topbar onMenuClick={() => setSidebarOpen(o => !o)} />
                <StatusBar />
                <main className="app-content">{children}</main>
            </div>
            <LiveAnalyticsBadge />
            <FloatingDialer />
            <WrapUpModal />
            <QuickTicketModal />
        </div>
    );
}
