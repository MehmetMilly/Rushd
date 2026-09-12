import { defineConfig } from 'vitest/config';

// P04-D3 focused gate: Home/Add/Transactions canonical ports, controller
// routing support, coordination/epoch hardening, and the candidate shell.
// The D2 suites keep running under tests/pwa/vitest.p04d2.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/pwa/p04-d3-*.test.ts'],
    testTimeout: 60_000,
  },
});
