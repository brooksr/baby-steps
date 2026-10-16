import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/baby-steps/',
  plugins: [react()],
  test: {
    css: true,
    exclude: [...configDefaults.exclude, 'android/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts'
  }
});
