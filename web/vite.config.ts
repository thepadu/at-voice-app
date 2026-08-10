import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base: '/app/' because Express serves this build under /app (see app.js) —
// dashboard.js has been retired, so the old HTML dashboard no longer
// competes for a URL, but the SPA stays at /app rather than / since / is a
// plain-text health check Render may depend on.
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
            manifest: {
                name: 'Chumz Call Center',
                short_name: 'Chumz',
                description: 'Chumz customer support call-center dashboard and softphone',
                start_url: '/app/',
                scope: '/app/',
                display: 'standalone',
                theme_color: '#17A697',
                background_color: '#F9F9F9',
                icons: [
                    { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
                    { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
                ]
            },
            workbox: {
                // Only the SPA's own built assets (under /app/) get any
                // caching benefit, for fast reloads and installability.
                // Everything else — the JSON API, auth redirects, the
                // server-rendered /login page — must always hit the network
                // fresh. This is a real-time call center tool; a cached
                // stale API response (an agent's own status, a live queue
                // count) would be actively wrong, not just outdated.
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) => !url.pathname.startsWith('/app/'),
                        handler: 'NetworkOnly'
                    }
                ]
            }
        })
    ],
    base: '/app/',
    build: {
        outDir: 'dist'
    },
    server: {
        // Lets `npm run dev` (Vite's own dev server) proxy API/auth calls to
        // the real Express server running locally, so you don't need to
        // rebuild the SPA on every change during development.
        proxy: {
            '/api': 'http://localhost:3000',
            '/login': 'http://localhost:3000',
            '/auth': 'http://localhost:3000',
            '/logout': 'http://localhost:3000'
        }
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/test/setup.ts'
    }
});
