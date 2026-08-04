import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: '/app/' because Express serves this build under /app (see app.js) —
// dashboard.js keeps serving the old HTML pages at '/' and '/dashboard' in
// the meantime, so this app lives at a separate path rather than replacing
// them outright.
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
    }
});
