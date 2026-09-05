import { defineConfig } from 'vitest/config';

// P03 Task A test runner. Only the canonical domain/property suites are run
// through Vitest; the P00-P02 regression scripts stay plain node scripts and
// keep running through `npm test` unchanged.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/domain/**/*.test.ts', 'tests/property/**/*.test.ts'],
  },
});
