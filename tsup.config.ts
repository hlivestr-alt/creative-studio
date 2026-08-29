import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'electron/main/index.ts', preload: 'electron/preload/index.ts' },
  outDir: 'dist-electron',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['electron', 'sql.js'],
  outExtension: () => ({ js: '.cjs' })
});
