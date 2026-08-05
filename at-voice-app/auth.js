const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

module.exports = function (app, supabase) {

    const client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_CALLBACK_URL
    );

    // Login is open to ANY Google account — no domain or allowlist check.
    // This was a deliberate choice (confirmed 2026-08-05), not an oversight:
    // anyone who reaches /login and signs in with Google gets a session.
    // What they can DO once signed in is governed by role (below) — an
    // unrecognized email defaults to 'agent', the more restricted role.

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
        <head>
            <meta charset="utf-8">
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link href="https://fonts.googleapis.com/css2?family=Sora:wght@700;800&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
                * { box-sizing: border-box; }
                body {
                    margin: 0;
                    font-family: 'Public Sans', -apple-system, sans-serif;
                    background: #f8fafc;
                    display: flex;
                    height: 100vh;
                    align-items: center;
                    justify-content: center;
                }
                .card {
                    background: white;
                    padding: 40px;
                    border-radius: 12px;
                    border: 1px solid #e2e8f0;
                    text-align: center;
                    max-width: 360px;
                }
                .logo {
                    width: 34px;
                    height: 34px;
                    border-radius: 9px;
                    background: #4ade80;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: 'Sora', sans-serif;
                    font-weight: 800;
                    color: #14532d;
                    margin: 0 auto 16px;
                }
                h2 { font-family: 'Sora', sans-serif; font-weight: 800; margin: 0 0 6px; color: #0f172a; }
                p { color: #64748b; font-size: 14px; margin: 0 0 24px; }
                a.btn {
                    display: inline-block;
                    background: #15803d;
                    color: white;
                    padding: 11px 22px;
                    border-radius: 8px;
                    text-decoration: none;
                    font-weight: 700;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="logo">C</div>
                <h2>Chumz Support</h2>
                <p>Sign in with Google to continue</p>
                <a href="/auth/google" class="btn">Sign in with Google</a>
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

            // Look up whether this email is a recognized agent, and if so
            // what role/id they hold. Unrecognized emails default to 'agent'
            // (the more restricted role) rather than failing login — login
            // itself stays open to anyone, per the policy above. `agentId`
            // (when present) is how the frontend matches "my performance"
            // out of the agent-stats list without a separate lookup.
            const { data: agent } = await supabase
                .from('agents')
                .select('id, role')
                .eq('email', payload.email)
                .maybeSingle();

            const role = agent?.role === 'supervisor' ? 'supervisor' : 'agent';

            const sessionToken = jwt.sign(
                { email: payload.email, name: payload.name, role, agentId: agent?.id ?? null },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.cookie('session', sessionToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            res.redirect('/app');
        } catch (error) {
            console.error('❌ Google auth failed:', error.message);
            res.status(401).send('Authentication failed');
        }
    });

    app.get('/logout', (req, res) => {
        res.clearCookie('session');
        res.redirect('/login');
    });

    // Protects the JSON API (api.js) and the /export and /ticket routes —
    // API requests get a 401 JSON body instead of a redirect, since a
    // fetch() call has no browser chrome to redirect.
    function requireAuth(req, res, next) {
        try {
            req.user = jwt.verify(req.cookies.session, process.env.JWT_SECRET);
            next();
        } catch {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            res.redirect('/login');
        }
    }

    // Stricter than requireAuth — role is baked into the JWT at login time,
    // so promoting someone to supervisor requires them to log out/in (or
    // wait out the 7-day token expiry) before it takes effect.
    function requireSupervisor(req, res, next) {
        requireAuth(req, res, () => {
            if (req.user?.role !== 'supervisor') {
                if (req.path.startsWith('/api/')) {
                    return res.status(403).json({ error: 'Supervisor access required' });
                }
                return res.status(403).send('Supervisor access required');
            }
            next();
        });
    }

    return { requireAuth, requireSupervisor };
};
