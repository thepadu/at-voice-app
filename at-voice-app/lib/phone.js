// Shared phone helpers. Previously duplicated (slightly differently) across
// app.js, outbound.js, and the now-deleted dashboard.js.
//
// Validation is intentionally general E.164 (+ up to 15 digits) rather than
// Kenya-only — the original per-file regexes were hardcoded to +254, which
// would silently reject Rwanda (+250) numbers whenever that market gets
// added. No behavior change for Kenya numbers today.

function isValidE164(phone) {
    return /^\+\d{8,15}$/.test(phone || '');
}

// Normalizes to the bare-digits form used for call_logs.caller and for
// comparing against Africa's Talking event payloads (which arrive without
// a leading +, per observed behavior — see app.js's /events handler).
function normalizePhone(phone) {
    if (!phone) return null;
    phone = phone.replace(/\s+/g, '').trim();
    if (phone.startsWith('+')) return phone.substring(1);
    if (phone.startsWith('0')) return '254' + phone.substring(1);
    return phone;
}

// Normalizes to the +-prefixed E.164 form Africa's Talking's Voice API
// expects for callFrom/callTo/phoneNumbers.
//
// NOTE: a bare local-format number ("0712345678") is ambiguous without
// knowing the country — this assumes Kenya (+254) since that's the only
// market today. When Rwanda (+250) is added, callers of this function will
// need a country hint rather than relying on this default.
function toE164(phone) {
    if (!phone) return null;
    phone = phone.replace(/\s+/g, '').trim();
    if (phone.startsWith('+')) return phone;
    if (phone.startsWith('254') || phone.startsWith('250')) return '+' + phone;
    if (phone.startsWith('0')) return '+254' + phone.substring(1);
    return phone;
}

module.exports = { isValidE164, normalizePhone, toE164 };
