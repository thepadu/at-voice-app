const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

module.exports = function (app) {

    const client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_CALLBACK_URL
    );

    const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'chumz.io';

    app.get('/login', (req, res) => {
        res.send(`
        <html>
        <body style="font-family:-apple-system,sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;background:#F5F7FB;">
            <div style="background:white;padding:40px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.05);text-align:center;">
                <h2>💚 Chumz Support</h2>
                <p style="color:#6B7280;">Sign in with your @${ALLOWED_DOMAIN} Google account</p>
                <a href="/auth/google" style="display:inline-block;background:#0F9D58;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">
                    Sign in with Google
                </a>
            </div>
        </body>
        </html>
        `);
    });

    app.get('/auth/google', (req, res) => {
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

            const emailDomain = (payload.email || '').split('@')[1];
            if (emailDomain !== ALLOWED_DOMAIN || !payload.email_verified) {
                return res.status(403).send(`Access restricted to @${ALLOWED_DOMAIN} accounts`);
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
