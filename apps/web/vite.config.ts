/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API is reached through /api on the same origin, exactly as
// in production (where the hosting provider proxies /api to the API service).
// Same-origin keeps the session cookie first-party and SameSite=Lax.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': { target: 'http://localhost:4100', rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  preview: {
    port: 5174,
    proxy: { '/api': { target: 'http://localhost:4100', rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
});
