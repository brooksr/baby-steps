import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/baby-steps/',
  plugins: [react()],
  test: {
    css: true,
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts'
  }
});
