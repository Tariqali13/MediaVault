import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts', 'src/db/migrate-cli.ts', 'src/demo/prerender.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The shared contracts package is TypeScript source; bundle it in.
  noExternal: ['@mediavault/shared'],
});
