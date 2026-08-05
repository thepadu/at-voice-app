// Shared by the floating dialer widget and its tests. Kenya-specific for
// now (same caveat as the backend's lib/phone.js) — will need a country
// hint once Rwanda is added.
export function formatPhone(phone: string): string {
    const trimmed = phone.replace(/\s+/g, '').trim();
    if (trimmed.startsWith('0')) return '254' + trimmed.substring(1);
    if (trimmed.startsWith('+254')) return trimmed.substring(1);
    return trimmed;
}

export function isValidPhone(phone: string): boolean {
    return /^254(7|1)\d{8}$/.test(phone);
}
