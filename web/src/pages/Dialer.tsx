import { useState } from 'react';
import { apiFetch } from '../lib/api';

// Same normalization/validation rules as the old HTML dashboard's dialer
// (dashboard.js) — kept identical so behavior doesn't change for agents.
function formatPhone(phone: string) {
    const trimmed = phone.replace(/\s+/g, '').trim();
    if (trimmed.startsWith('0')) return '254' + trimmed.substring(1);
    if (trimmed.startsWith('+254')) return trimmed.substring(1);
    return trimmed;
}

function isValid(phone: string) {
    return /^254(7|1)\d{8}$/.test(phone);
}

export default function Dialer() {
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    async function makeCall() {
        const phone = formatPhone(input);

        if (!isValid(phone)) {
            setError('Enter a valid Kenyan number');
            setStatus('');
            return;
        }

        setError('');

        try {
            await apiFetch('/call', { method: 'POST', body: JSON.stringify({ phone }) });
            setStatus(`📞 Calling ${phone}`);
        } catch {
            setStatus('Call failed');
        }
    }

    return (
        <div className="panel">
            <h3>📞 Manual Dialer</h3>
            <div className="dialer-row">
                <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="0712345678"
                />
                <button onClick={makeCall}>Call</button>
            </div>
            {error && <p className="error">{error}</p>}
            {status && <p className="status">{status}</p>}
        </div>
    );
}
