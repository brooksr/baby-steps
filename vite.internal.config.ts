import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';
export default defineConfig({
  build: { emptyOutDir: true, outDir: 'dist-internal', rollupOptions: { external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    input: { 'internal-api':'src/server/internal/main.ts', 'internal-tool':'src/server/internal/tool.ts' },
    output: { chunkFileNames:'chunks/[name]-[hash].mjs',entryFileNames: '[name].mjs' } }, ssr: true, target: 'node24' },
  publicDir: false,
  ssr: { noExternal: true }
});
