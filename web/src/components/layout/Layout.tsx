import { ReactNode } from 'react';
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

    return (
        <div className="app-shell">
            <Sidebar />
            <IncomingCallBanner />
            <OutgoingCallBanner />
            <div className="app-shell-main">
                <Topbar />
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
