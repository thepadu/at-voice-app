const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

module.exports = function (app) {

    const client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_CALLBACK_URL
    );

    // Login is open to ANY Google account — no domain or allowlist check.
    // This was a deliberate choice (confirmed 2026-08-05), not an oversight:
    // anyone who reaches /login and signs in with Google gets full access to
    // call logs (customer phone numbers), agent management, the IVR editor,
    // and the dialer (which places real, billed calls). Revisit this if that
    // stops being an acceptable tradeoff — an allowlist is a small change
    // from here (check payload.email against a stored list of approved
    // addresses in the callback below, instead of skipping the check).

    // Without these, generateAuthUrl() silently builds a URL with no
    // redirect_uri param, which Google rejects with a cryptic
    // "Missing required parameter: redirect_uri" error on its own consent
    // screen — nothing in this app's own logs. Fail loudly here instead.
    const missingEnvVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL', 'JWT_SECRET']
        .filter(key => !process.env[key]);

    if (missingEnvVars.length) {
        console.error(`❌ Google SSO is misconfigured — missing env var(s): ${missingEnvVars.join(', ')}`);
    }

    app.get('/login', (req, res) => {
        res.send(`
        <html>
        <body style="font-family:-apple-system,sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;background:#F5F7FB;">
            <div style="background:white;padding:40px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.05);text-align:center;">
                <h2>💚 Chumz Support</h2>
                <p style="color:#6B7280;">Sign in with Google to continue</p>
                <a href="/auth/google" style="display:inline-block;background:#0F9D58;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">
                    Sign in with Google
                </a>
            </div>
        </body>
        </html>
        `);
    });

    app.get('/auth/google', (req, res) => {
        if (missingEnvVars.length) {
            return res.status(500).send(
                `Google SSO is misconfigured on the server — missing: ${missingEnvVars.join(', ')}. ` +
                `Set these in Render's Environment tab and redeploy.`
            );
        }

        const url = client.generateAuthUrl({
            scope: ['profile', 'email'],
            prompt: 'select_account'
        });
        res.redirect(url);
    });

    app.get('/auth/google/callback', async (req, res) => {
        try {
            const { tokens } = await client.getToken(req.query.code);
            const ticket = await client.verifyIdToken({
                idToken: tokens.id_token,
                audience: process.env.GOOGLE_CLIENT_ID
            });

            const payload = ticket.getPayload();

            if (!payload.email_verified) {
                return res.status(403).send('Your Google account email is not verified');
            }

            const sessionToken = jwt.sign(
                { email: payload.email, name: payload.name },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.cookie('session', sessionToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            res.redirect('/dashboard');
        } catch (error) {
            console.error('❌ Google auth failed:', error.message);
            res.status(401).send('Authentication failed');
        }
    });

    app.get('/logout', (req, res) => {
        res.clearCookie('session');
        res.redirect('/login');
    });

    // Protects both the HTML dashboard and the JSON API (api.js) — API
    // requests get a 401 JSON body instead of a redirect, since a fetch()
    // call has no browser chrome to redirect.
    return function requireAuth(req, res, next) {
        try {
            req.user = jwt.verify(req.cookies.session, process.env.JWT_SECRET);
            next();
        } catch {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            res.redirect('/login');
        }
    };
};
