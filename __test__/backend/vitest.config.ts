import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Windows runners finish the reference-deconstruction journeys slower
    // than the 5s default. Other platforms keep Vitest's default timeout.
    testTimeout: process.platform === 'win32' ? 30_000 : 5_000,
  },
});
