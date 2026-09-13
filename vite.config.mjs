// @ts-check
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = dirname(fileURLToPath(import.meta.url));

// P04-D4: the production canonical host opens its durable SQLite worker at
// the stable root URL `/sqlite-worker.js` and loads wa-sqlite engine files
// from `/pkg`. This plugin emits both from local sources only (no
// downloads). The worker is bundled with the repo's esbuild exactly like
// the PWA test harness does, so its runtime dynamic imports stay native:
// Rollup's preload helper touches `window`/`document` and cannot run in a
// DedicatedWorker. The engine files are the exact runtime closure the
// worker imports (`dist/wa-sqlite.mjs` + its sibling wasm,
// `src/sqlite-api.js` + constants, and the `OPFSCoopSyncVFS` example +
// its VFS base files).
const WA_SQLITE_CLOSURE = [
  'dist/wa-sqlite.mjs',
  'dist/wa-sqlite.wasm',
  'src/sqlite-api.js',
  'src/sqlite-constants.js',
  'src/FacadeVFS.js',
  'src/VFS.js',
  'src/examples/OPFSCoopSyncVFS.js',
];

function rushdWorkerAssets() {
  return {
    name: 'rushd-p04d-worker-assets',
    apply: 'build',
    closeBundle() {
      execFileSync(join(repoRoot, 'node_modules/.bin/esbuild'), [
        'src/data/v2/sqlite-worker.ts',
        '--bundle',
        '--format=esm',
        '--platform=browser',
        '--outfile=dist/sqlite-worker.js',
      ], { cwd: repoRoot, stdio: 'pipe' });
      const pkgRoot = join(repoRoot, 'node_modules/@journeyapps/wa-sqlite');
      for (const file of WA_SQLITE_CLOSURE) {
        const target = join(repoRoot, 'dist/pkg', file);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(pkgRoot, file), target);
      }
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    // P02 keeps the runtime compiler while root and legacy component templates
    // are raw strings. P05/P06 own SFC conversion and can remove this alias.
    alias: {
      vue: fileURLToPath(new URL('./node_modules/vue/dist/vue.esm-bundler.js', import.meta.url))
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: 'index.html'
    }
  },
  plugins: [rushdWorkerAssets()],
});
