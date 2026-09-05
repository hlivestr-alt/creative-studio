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
  outExtension: () => ({ js: '.cjs' }),
  // h3.ts is shared by the renderer and main-process contract builder. Keep
  // its Vite-style ?raw Markdown import bundleable in the Electron build.
  esbuildOptions(options) {
    options.loader = { ...options.loader, '.md': 'text' };
  }
});
