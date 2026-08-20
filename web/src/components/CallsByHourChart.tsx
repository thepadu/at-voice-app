type Props = { hours: { hour: number; count: number }[]; isLoading?: boolean };

export default function CallsByHourChart({ hours, isLoading }: Props) {
    const max = Math.max(1, ...hours.map(h => h.count));

    return (
        <div className="panel">
            <h3>Calls by hour</h3>
            {isLoading && <p className="empty">Loading…</p>}
            {!isLoading && hours.length === 0 && <p className="empty">No calls logged today yet.</p>}
            {!isLoading && hours.length > 0 && (
                <div className="hour-chart">
                    {hours.map(h => (
                        <div className="hour-chart-bar-col" key={h.hour}>
                            <div className="hour-chart-bar" style={{ height: `${Math.round((h.count / max) * 100)}%` }} />
                            <div className="hour-chart-label">{h.hour % 12 === 0 ? 12 : h.hour % 12}{h.hour < 12 ? 'a' : 'p'}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
