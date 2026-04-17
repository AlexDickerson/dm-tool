import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Vitest config. Tests live colocated with source as `*.test.ts` /
// `*.test.tsx`. Default environment is Node — tests that need the DOM
// opt in per file with `/** @vitest-environment happy-dom */`.
//
// Path aliases mirror tsconfig.web.json / tsconfig.node.json so imports
// in tests look identical to imports in the code under test.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['electron/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'out/**', 'dist/**', 'tagger/**', 'player-map/**', '.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['electron/**/*.ts', 'shared/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        'electron/main.ts',
        'electron/preload.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
});
