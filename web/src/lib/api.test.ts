import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError } from './api';

function mockResponse(body: string, init: { status?: number; contentType?: string } = {}) {
    return new Response(body, {
        status: init.status ?? 200,
        headers: { 'content-type': init.contentType ?? 'application/json' }
    });
}

describe('apiFetch', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('parses a successful JSON response', async () => {
        vi.mocked(fetch).mockResolvedValue(mockResponse(JSON.stringify({ ok: true })));
        await expect(apiFetch('/api/me')).resolves.toEqual({ ok: true });
    });

    it('returns raw text for a non-JSON response (e.g. /call)', async () => {
        vi.mocked(fetch).mockResolvedValue(mockResponse('Calling 254712345678', { contentType: 'text/html' }));
        await expect(apiFetch('/call')).resolves.toBe('Calling 254712345678');
    });

    it('extracts the message from a JSON {error} body on failure', async () => {
        vi.mocked(fetch).mockResolvedValue(
            mockResponse(JSON.stringify({ error: 'Invalid phone number' }), { status: 400 })
        );
        await expect(apiFetch('/api/agents')).rejects.toMatchObject(
            new ApiError(400, 'Invalid phone number')
        );
    });

    it('falls back to the raw body when the error response is not JSON', async () => {
        vi.mocked(fetch).mockResolvedValue(mockResponse('Call failed', { status: 500, contentType: 'text/html' }));
        await expect(apiFetch('/call')).rejects.toMatchObject(new ApiError(500, 'Call failed'));
    });
});
