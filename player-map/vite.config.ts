import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The shared type definitions live in the parent repo's `shared/` directory
// so the player-map and the main dm-tool renderer agree on the exported
// data shape. Vite bundles the resolved files into the SPA at build time,
// so the deploy tarball stays self-contained.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
