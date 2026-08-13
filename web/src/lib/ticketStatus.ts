// Tickets use a different (capitalized) status vocabulary than call_logs —
// kept separate from StatusPill's map rather than forcing a case-insensitive
// lookup there, since the two vocabularies aren't actually the same concept.
export const TICKET_STATUS_COLORS: Record<string, string> = {
    Open: '#EF5350',
    'Follow-up needed': '#F39C12',
    Escalated: '#F39C12',
    Resolved: '#17A697',
    'No resolution': '#757575'
};

export const TICKET_STATUSES = ['Open', 'Resolved', 'Escalated', 'Follow-up needed', 'No resolution'];
export const TICKET_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

export const TICKET_PRIORITY_COLORS: Record<string, string> = {
    Low: '#757575',
    Medium: '#4DB8AA',
    High: '#F39C12',
    Urgent: '#EF5350'
};
