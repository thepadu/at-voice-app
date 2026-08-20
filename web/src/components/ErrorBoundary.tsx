import { Component, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean };

// Nothing in this app previously caught a render-time error anywhere — one
// bad payload shape from any page/widget blanked the entire dashboard with
// no recovery UI, no matter how unrelated to an actual in-progress call.
// The softphone's own SIP session (lib/softphone.tsx) lives outside React's
// render tree and keeps running regardless, so a real call in progress
// survives this even though every control around it briefly won't.
export default class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: unknown, info: unknown) {
        console.error('[ErrorBoundary] caught a render error:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="error-boundary">
                    <div className="error-boundary-card">
                        <h3>Something went wrong</h3>
                        <p className="hint">
                            The dashboard hit an unexpected error. If you're on a call, it's still connected — reload
                            to bring the controls back.
                        </p>
                        <button className="btn btn-primary" onClick={() => window.location.reload()}>
                            Reload
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
