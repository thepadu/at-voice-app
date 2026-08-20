// Shared by every place that renders a seconds count as m:ss (call timers,
// wait times, hold duration) — previously duplicated with slightly
// different edge-case handling in each call site.
export function formatDuration(sec: number) {
    const safeSec = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
    const m = Math.floor(safeSec / 60);
    const s = safeSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}
