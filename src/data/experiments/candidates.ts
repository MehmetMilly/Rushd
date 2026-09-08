/**
 * P04-A-FIX-01 pinned storage-candidate matrix.
 *
 * Both candidates share one pinned distribution. Documented claims cite
 * primary sources; measured behavior lives in
 * `artifacts/agent-reports/p04a-raw/candidate-experiment.json`.
 *
 * Distribution: `@journeyapps/wa-sqlite@2.0.4` (exact pin, 0
 * dependencies), published 2026-09-03, sourced from the maintained
 * PowerSync/JourneyApps fork `github.com/powersync-ja/wa-sqlite` of
 * upstream `github.com/rhashimoto/wa-sqlite`. License: MIT (LICENSE file,
 * upstream copyright 2023 Roy T. Hashimoto; the npm `license` field is
 * empty, the README states MIT since 2023-02-10). The unscoped
 * `wa-sqlite@1.0.0` npm release is not official (upstream disavowal) and is
 * not used. Engine `SELECT sqlite_version()` reports `3.53.0` on both
 * candidates (measured in the browser experiment).
 *
 * Plain IndexedDB objects remain a rejected, unbenchmarked non-candidate:
 * they are not a documented SQLite-compatible VFS.
 */

export type CandidateId = 'idb-batch-atomic' | 'opfs-coop-sync';

export interface PinnedDistribution {
  readonly package: '@journeyapps/wa-sqlite';
  readonly version: '2.0.4';
  readonly published: '2026-09-03';
  readonly sourceRepository: 'github.com/powersync-ja/wa-sqlite';
  readonly upstreamRepository: 'github.com/rhashimoto/wa-sqlite';
  readonly license: 'MIT';
  readonly sqliteEngine: '3.53.0';
  readonly syncBuild: readonly string[];
  readonly asyncBuild: readonly string[];
  readonly sharedModules: readonly string[];
}

export const PINNED_DISTRIBUTION: PinnedDistribution = {
  package: '@journeyapps/wa-sqlite',
  version: '2.0.4',
  published: '2026-09-03',
  sourceRepository: 'github.com/powersync-ja/wa-sqlite',
  upstreamRepository: 'github.com/rhashimoto/wa-sqlite',
  license: 'MIT',
  sqliteEngine: '3.53.0',
  syncBuild: ['dist/wa-sqlite.mjs', 'dist/wa-sqlite.wasm'],
  asyncBuild: ['dist/wa-sqlite-async.mjs', 'dist/wa-sqlite-async.wasm'],
  sharedModules: [
    'src/sqlite-api.js',
    'src/FacadeVFS.js',
    'src/VFS.js',
    'src/WebLocksMixin.js',
    'src/types/index.d.ts',
    'src/examples/IDBBatchAtomicVFS.js',
    'src/examples/OPFSCoopSyncVFS.js',
  ],
};

export interface StorageCandidate {
  readonly id: CandidateId;
  readonly vfs: 'IDBBatchAtomicVFS' | 'OPFSCoopSyncVFS';
  readonly build: 'asyncify' | 'default-sync';
  readonly topology: string;
  readonly multiConnectionDocumented: boolean;
  readonly durabilityDocumented: string;
  readonly requirements: readonly string[];
  readonly knownLimitations: readonly string[];
  readonly primarySource: string;
}

export const STORAGE_CANDIDATES: readonly StorageCandidate[] = [
  {
    id: 'idb-batch-atomic',
    vfs: 'IDBBatchAtomicVFS',
    build: 'asyncify',
    topology: 'Dedicated Worker in Task A (works in any context: Window, Worker, SharedWorker, service worker)',
    multiConnectionDocumented: true,
    durabilityDocumented: 'Full (batch-atomic IndexedDB writes; journal fits in page cache)',
    requirements: ['Web Locks API', 'page cache sized to hold the journal for batch-atomic mode'],
    knownLimitations: [
      'VFS examples are upstream proof-of-concept, not production-hardened storage',
      'Second BEGIN IMMEDIATE blocks (measured: 8 s without BUSY) instead of failing fast — contention serializes at the lock',
      'Changing the page size after creation is unsupported',
    ],
    primarySource: '@journeyapps/wa-sqlite@2.0.4 src/examples/IDBBatchAtomicVFS.js + upstream examples README',
  },
  {
    id: 'opfs-coop-sync',
    vfs: 'OPFSCoopSyncVFS',
    build: 'default-sync',
    topology: 'Dedicated Worker (synchronous OPFS access handles require a worker)',
    multiConnectionDocumented: true,
    durabilityDocumented: 'Full, filesystem transparent',
    requirements: ['OPFS FileSystemSyncAccessHandle', 'dedicated Web Worker'],
    knownLimitations: [
      'VFS examples are upstream proof-of-concept, not production-hardened storage',
      'Transactions touching more than one main database are unsupported',
      'Second BEGIN IMMEDIATE succeeded immediately in probing (measured) — conflict surfaces later; full dance characterized in the experiment',
      'Official sqlite-wasm docs note Safari < 17 incompatibility (WebKit bug 255458); needs physical proof on 17+',
      'Chromium on Apple devices uses F_FULLFSYNC for OPFS flush (documented): slower writes, higher durability',
    ],
    primarySource: '@journeyapps/wa-sqlite@2.0.4 src/examples/OPFSCoopSyncVFS.js + upstream examples README',
  },
];

/** Why plain IndexedDB records are not an eligible candidate. */
export const REJECTED_PLAIN_IDB_REASON =
  'Plain IndexedDB objects are not a documented SQLite-compatible VFS and cannot satisfy ' +
  'the master plan Application/Local-data requirement on their own; they are rejected as an ' +
  'undocumented replacement, not benchmarked as a candidate.';

/**
 * Fork extras Task B must handle when vendoring: the fork bundles PowerSync
 * Rust-core builds (`mc-*`, `*-dynamic-*`) and downloads dynamic WASM in a
 * `postinstall` script (`scripts/tools/powersync-download.js`,
 * `powersync-version` pin). Offline bundling must vendor only the files in
 * PINNED_DISTRIBUTION and never depend on network fetches at build time.
 */
export const FORK_BUNDLING_NOTE =
  'Vendor only PINNED_DISTRIBUTION files; do not run the fork postinstall network download in the app build.';

/** Pinned official engine proof (installed experiment dependency, engine-shape evidence only). */
export const PINNED_ENGINE = {
  package: '@sqlite.org/sqlite-wasm',
  version: '3.53.0-build1',
  license: 'Apache-2.0',
  sqliteVersion: '3.53.0',
  sqliteSourceId: '2026-04-09 11:41:38 4525003a53a7fc63ca75c59b22c79608659ca12f0131f52c18637f829977f20b',
  nodeScope: 'In-memory databases only (documented); OPFS absent in Node (measured in Task A)',
} as const;
