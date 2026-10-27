import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: process.platform === 'win32' ? 30_000 : 5_000,
  },
});
