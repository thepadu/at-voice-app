import { useState } from 'react';
import { useToast } from '../../lib/toast';
import { useSoftphone } from '../../lib/softphone';
import { formatPhone, isValidPhone } from '../../lib/phoneFormat';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export default function FloatingDialer() {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const [calling, setCalling] = useState(false);
    const showToast = useToast();
    const { registrationState, placeCall } = useSoftphone();

    async function makeCall() {
        const phone = formatPhone(input);

        if (!isValidPhone(phone)) {
            setError('Enter a valid Kenyan number');
            return;
        }

        if (registrationState !== 'registered') {
            setError('Softphone is not registered yet — check your connection');
            return;
        }

        setError('');
        setCalling(true);

        try {
            // formatPhone strips the leading "+" (254XXXXXXXXX); the
            // dialplan's outbound pattern expects the full E.164 form.
            // No toast here — the outgoing-call banner takes over as the
            // "calling…" feedback the moment placeCall's INVITE goes out.
            await placeCall(`+${phone}`);
            setInput('');
            setOpen(false);
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Call failed', 'error');
        } finally {
            setCalling(false);
        }
    }

    return (
        <div className="floating-dialer">
            {open && (
                <div className="dialer-popover">
                    <div className="dialer-popover-title">Dialer</div>
                    <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && makeCall()}
                        placeholder="Enter number"
                        className="dialer-input"
                        autoFocus
                    />
                    <div className="dialer-keypad">
                        {KEYS.map(k => (
                            <button key={k} className="dialer-key" onClick={() => setInput(i => i + k)}>
                                {k}
                            </button>
                        ))}
                    </div>
                    {error && <p className="error">{error}</p>}
                    <div className="dialer-popover-actions">
                        <button className="btn btn-primary" onClick={makeCall} disabled={calling}>
                            {calling ? 'Calling…' : 'Call'}
                        </button>
                        <button className="btn btn-secondary" onClick={() => setInput('')}>
                            Clear
                        </button>
                    </div>
                </div>
            )}
            <button
                className="fab fab-dialer"
                onClick={() => setOpen(o => !o)}
                title="Quick dial"
                aria-label="Quick dial"
                aria-expanded={open}
            >
                📞
            </button>
        </div>
    );
}
