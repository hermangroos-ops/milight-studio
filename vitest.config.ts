import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const resolve = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Workspace packages are aliased to their sources so tests run without a build step
 * and coverage is reported against the real source files rather than compiled output.
 */
const alias = {
  '@milight-studio/shared': resolve('./packages/shared/src/index.ts'),
  '@milight-studio/milight-client': resolve('./packages/milight-client/src/index.ts'),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['apps/server/tests/integration/**/*.test.ts'],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'api',
          environment: 'node',
          include: ['apps/server/tests/api/**/*.test.ts'],
          testTimeout: 20_000,
        },
      },
      {
        resolve: { alias },
        plugins: [(await import('@vitejs/plugin-react')).default()],
        test: {
          name: 'web',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./apps/web/tests/setup.ts'],
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'apps/server/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/index.ts',
        '**/*.d.ts',
        'apps/server/src/main.ts',
        'apps/web/src/main.tsx',
        'apps/server/src/bridges/matter/**',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 82,
        statements: 85,
      },
    },
  },
});
