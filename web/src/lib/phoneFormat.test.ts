import { describe, expect, it } from 'vitest';
import { formatPhone, isValidPhone } from './phoneFormat';

describe('formatPhone', () => {
    it('converts a leading 0 to 254', () => {
        expect(formatPhone('0712345678')).toBe('254712345678');
    });

    it('strips a leading +254', () => {
        expect(formatPhone('+254712345678')).toBe('254712345678');
    });

    it('leaves an already-bare 254 number unchanged', () => {
        expect(formatPhone('254712345678')).toBe('254712345678');
    });

    it('strips whitespace', () => {
        expect(formatPhone(' 0712 345 678 ')).toBe('254712345678');
    });
});

describe('isValidPhone', () => {
    it('accepts a valid Safaricom-range number', () => {
        expect(isValidPhone('254712345678')).toBe(true);
    });

    it('accepts a valid Airtel-range (1xx) number', () => {
        expect(isValidPhone('254112345678')).toBe(true);
    });

    it('rejects a number that is too short', () => {
        expect(isValidPhone('25471234567')).toBe(false);
    });

    it('rejects a number with the wrong prefix', () => {
        expect(isValidPhone('254812345678')).toBe(false);
    });

    it('rejects a non-numeric string', () => {
        expect(isValidPhone('not-a-phone')).toBe(false);
    });
});
