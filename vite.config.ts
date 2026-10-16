import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/baby-steps/',
  plugins: [react()],
  test: {
    css: true,
    // Clock assertions are written for the household's zone; CI runs in UTC.
    env: { TZ: 'America/Los_Angeles' },
    exclude: [...configDefaults.exclude, 'android/**', 'e2e/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts'
  }
});
