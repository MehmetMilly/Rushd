import { defineConfig } from 'vitest/config';

// P04-D4 focused gate: remaining canonical ports (plan, insights, goals,
// settings, navigation), failure/cross-tab behavior, and the production
// cutover freeze. Earlier suites keep running under their own configs.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/pwa/p04-d4-*.test.ts'],
    testTimeout: 60_000,
  },
});
