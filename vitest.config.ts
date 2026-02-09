import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types.ts',
        '**/index.ts',
      ],
      thresholds: {
        global: {
          branches: 60,
          functions: 60,
          lines: 60,
          statements: 60,
        },
      },
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@chronosops/core': path.resolve(__dirname, 'packages/core/src'),
      '@chronosops/gemini': path.resolve(__dirname, 'packages/gemini/src'),
      '@chronosops/kubernetes': path.resolve(__dirname, 'packages/kubernetes/src'),
      '@chronosops/database': path.resolve(__dirname, 'packages/database/src'),
      '@chronosops/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@chronosops/video': path.resolve(__dirname, 'packages/video/src'),
    },
  },
});
