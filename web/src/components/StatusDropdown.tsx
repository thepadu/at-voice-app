import { ChevronDown } from 'lucide-react';
import { STATUS_COLORS } from './StatusPill';

type StatusDropdownProps = {
    value: string;
    options: string[];
    onChange: (status: string) => void;
    disabled?: boolean;
    title?: string;
    colors?: Record<string, string>;
};

// A colored, dropdown-styled <select> — shares StatusPill's color map by
// default so an agent/call status reads the same whether it's shown as a
// static pill or an editable control. Callers with their own vocabulary
// (e.g. ticket statuses) pass their own `colors` map instead. `value` may be
// outside `options` (e.g. the system-managed on_call/ringing states) — it's
// still rendered as the current selection, just not one the user picked
// from the list, so callers can decide per context whether that state
// should also be re-selectable (a supervisor overriding a stuck agent) or
// locked out entirely (via `disabled`).
export default function StatusDropdown({ value, options, onChange, disabled, title, colors = STATUS_COLORS }: StatusDropdownProps) {
    const color = colors[value] || '#757575';
    const allOptions = options.includes(value) ? options : [value, ...options];

    return (
        <div className={`status-dropdown ${disabled ? 'status-dropdown-disabled' : ''}`} style={{ background: color }} title={title}>
            <select
                className="status-dropdown-select"
                value={value}
                disabled={disabled}
                onChange={e => onChange(e.target.value)}
            >
                {allOptions.map(opt => (
                    <option key={opt} value={opt}>
                        {opt.replace('_', ' ')}
                    </option>
                ))}
            </select>
            <ChevronDown size={13} className="status-dropdown-chevron" aria-hidden="true" />
        </div>
    );
}
