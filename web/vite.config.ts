/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base: '/app/' because Express serves this build under /app (see app.js) —
// dashboard.js has been retired, so the old HTML dashboard no longer
// competes for a URL, but the SPA stays at /app rather than / since / is a
// plain-text health check Render may depend on.
export default defineConfig({
    plugins: [react()],
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
            '/call': 'http://localhost:3000',
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
