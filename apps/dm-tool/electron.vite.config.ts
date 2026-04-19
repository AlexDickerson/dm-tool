import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite gives us one config with three build targets:
//   - main   : the Electron main process (Node.js, our db/ipc/config code)
//   - preload: the contextBridge shim between main and renderer
//   - renderer: the React app loaded inside the BrowserWindow
//
// Shared types come from the @dm-tool/shared workspace package, resolved
// via node_modules symlinks — no manual alias needed.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@dm-tool/ai', '@dm-tool/db'] })],
    build: {
      rollupOptions: {
        // @dm-tool/db is bundled (raw .ts source), but its native dep
        // better-sqlite3 must stay external — Rollup can't bundle .node
        // binaries loaded via dynamic require.
        external: ['better-sqlite3'],
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@dm-tool/ai', '@dm-tool/db'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts'),
        },
      },
    },
  },
  renderer: {
    root: __dirname,
    plugins: [react()],
    server: {
      fs: {
        // Hoisted node_modules sits at the workspace root (two levels up
        // from here). Disable strict mode so Vite can serve hoisted
        // assets (pdfjs worker, fonts, etc.) that live outside this
        // package's directory.
        strict: false,
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
        },
      },
    },
  },
});
