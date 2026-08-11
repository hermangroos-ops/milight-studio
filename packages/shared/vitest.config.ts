import { defineConfig } from 'vitest/config';

/**
 * Standalone config so this package can be tested (and mutated by Stryker) on its own,
 * outside the root workspace projects.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
