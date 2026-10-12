import { defineConfig } from 'vite';

/**
 * The events API (`src/server/main.ts`) as one self-contained ES module for
 * Node — every import bundled, including the Sheets store and the reference
 * CSVs it pulls in, so the Pi needs no `node_modules`.
 */
export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist-server',
    rollupOptions: {
      output: { entryFileNames: 'events-api.mjs' }
    },
    ssr: 'src/server/main.ts',
    target: 'node22'
  },
  publicDir: false,
  ssr: {
    noExternal: true
  }
});
