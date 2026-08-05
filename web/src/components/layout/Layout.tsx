import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import FloatingDialer from '../widgets/FloatingDialer';
import LiveAnalyticsBadge from '../widgets/LiveAnalyticsBadge';

export default function Layout({ children }: { children: ReactNode }) {
    return (
        <div className="app-shell">
            <Sidebar />
            <div className="app-shell-main">
                <Topbar />
                <main className="app-content">{children}</main>
            </div>
            <LiveAnalyticsBadge />
            <FloatingDialer />
        </div>
    );
}
