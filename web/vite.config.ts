import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// React SPA. API calls are proxied to the Rust backend; the target is env-driven
// (SPNR_API) so the hermetic E2E can point it at its own backend port. In prod the
// backend serves this build (dist/) with an SPA fallback, so /api is same-origin.
const API = process.env.SPNR_API || 'http://127.0.0.1:8787';

// The /v2 demand-side endpoints (advertiser portal + auction) are served by the
// TypeScript Express service (server-ts/), a separate process from the Rust backend.
// Env-driven (SPNR_PORTAL_API) so the hermetic E2E can point it at its own port.
const PORTAL_API = process.env.SPNR_PORTAL_API || 'http://127.0.0.1:8790';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/v1': API,
      '/c': API,
      '/v2': PORTAL_API,
    },
  },
});
