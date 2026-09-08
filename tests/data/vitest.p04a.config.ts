import { defineConfig } from 'vitest/config';

// P04 Task A experiment runner. This scoped config runs only the Task A
// feasibility suites under tests/data. It exists so the experiment does not
// require any edit to the P03-owned root vitest.config.ts (a proposed
// discovery amendment for tests/data is recorded in the Task A report for
// Task B instead).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/data/**/*.test.ts'],
  },
});
