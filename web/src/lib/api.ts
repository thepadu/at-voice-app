export class ApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

// The React app is served by the same Express process as the API (see
// app.js), so the session cookie set by /auth/google/callback rides along
// automatically — no token storage needed here.
export async function apiFetch(path: string, options: RequestInit = {}) {
    const res = await fetch(path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });

    if (res.status === 401) {
        window.location.href = '/login';
        throw new ApiError(401, 'Not authenticated');
    }

    if (!res.ok) {
        const body = await res.text();
        throw new ApiError(res.status, body || 'Request failed');
    }

    // /call (outbound.js) responds with plain text, not JSON — everything
    // under /api/* does return JSON, so branch on content-type rather than
    // assuming one or the other.
    const contentType = res.headers.get('content-type') || '';
    return contentType.includes('application/json') ? res.json() : res.text();
}
