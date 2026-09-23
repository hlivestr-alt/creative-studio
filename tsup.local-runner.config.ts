import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { runner: 'src/local-runner/index.ts', 'package-smoke': 'src/local-runner/package-smoke.ts' },
  outDir: 'dist-local-runner',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['node:sqlite'],
  outExtension: () => ({ js: '.cjs' }),
  esbuildOptions(options) {
    options.loader = { ...options.loader, '.md': 'text' };
  }
});
