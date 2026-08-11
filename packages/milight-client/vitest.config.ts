import { defineConfig } from 'vitest/config';

/**
 * Standalone config so this package can be tested (and mutated by Stryker) on its own.
 *
 * Unlike the root config this does NOT alias `@milight-studio/shared` to its source: Stryker
 * runs the tests from a sandbox copy of this package, where a relative path out to a sibling
 * would dangle. Plain workspace resolution to the sibling's build output works in both places,
 * so run `pnpm run build` before `stryker run`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
