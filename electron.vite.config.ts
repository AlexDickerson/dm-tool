import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite gives us one config with three build targets:
//   - main   : the Electron main process (Node.js, our db/ipc/config code)
//   - preload: the contextBridge shim between main and renderer
//   - renderer: the React app loaded inside the BrowserWindow
//
// We keep path aliases consistent with the tsconfig files so IDE + build
// agree on resolution.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
      },
    },
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
        // In a git worktree node_modules lives in the main repo root,
        // which is outside this worktree directory. Disable strict mode
        // so Vite can serve pdfjs worker, fonts, etc. from there.
        strict: false,
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared'),
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
