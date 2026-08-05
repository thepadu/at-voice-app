import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatPhone, isValidPhone } from '../../lib/phoneFormat';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export default function FloatingDialer() {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const [calling, setCalling] = useState(false);
    const showToast = useToast();

    async function makeCall() {
        const phone = formatPhone(input);

        if (!isValidPhone(phone)) {
            setError('Enter a valid Kenyan number');
            return;
        }

        setError('');
        setCalling(true);

        try {
            await apiFetch('/call', { method: 'POST', body: JSON.stringify({ phone }) });
            showToast(`📞 Calling ${phone}`);
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
