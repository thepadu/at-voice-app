const COLORS: Record<string, string> = {
    available: '#10B981',
    offline: '#6B7280',
    completed: '#10B981',
    ongoing: '#3B82F6',
    failed: '#EF4444',
    open: '#EF4444',
    in_progress: '#F59E0B',
    resolved: '#10B981'
};

export default function StatusPill({ value, label }: { value: string; label?: string }) {
    const color = COLORS[value] || '#6B7280';
    return (
        <span className="status-pill" style={{ background: color }}>
            {label ?? value.replace('_', ' ')}
        </span>
    );
}
