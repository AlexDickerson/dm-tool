import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, Vite serves the SPA on :5173 and proxies API + map-tile traffic
// to the Fastify server on :3000. In prod, Fastify serves the built
// dist/ itself — Vite isn't in the loop.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/map': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
