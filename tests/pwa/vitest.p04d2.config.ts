import { defineConfig } from 'vitest/config';

// P04-D2 candidate host and PWA lifecycle gate. Scoped to tests/pwa so the
// candidate lifecycle, offline reload, update coordination, old-tab
// blocking, and failure recovery suites run without touching the P03-owned
// root vitest config.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/pwa/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
