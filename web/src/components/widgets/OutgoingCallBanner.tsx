import { useSoftphone } from '../../lib/softphone';

// Mirrors IncomingCallBanner's fixed-to-viewport treatment, but a calm blue
// identity rather than urgent amber — the agent chose to place this call, so
// it shouldn't compete for attention the way an unprompted incoming ring
// does. Hidden if a real incoming call is somehow ringing at the same
// instant — that takes priority over "calling out" feedback.
export default function OutgoingCallBanner() {
    const { outgoingCall, incomingCall, cancelOutgoingCall } = useSoftphone();

    if (!outgoingCall || incomingCall) return null;

    return (
        <div className="outgoing-call-banner">
            <div className="outgoing-call-info">
                <span className="outgoing-call-icon" aria-hidden="true">📞</span>
                Calling <strong>{outgoingCall.remoteNumber}</strong>…
            </div>
            <div className="outgoing-call-actions">
                <button className="btn outgoing-call-cancel" onClick={cancelOutgoingCall}>
                    Cancel
                </button>
            </div>
        </div>
    );
}
