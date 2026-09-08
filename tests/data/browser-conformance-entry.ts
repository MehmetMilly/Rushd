/**
 * Browser entry that runs the real P03 repository conformance suite against
 * the durable OPFS guest adapter. Bundled with a vitest alias so the suite
 * is not copied.
 */

import { runRepositoryConformanceSuite } from '../domain/support/repository-conformance';
import { createDurableConformanceFixture } from './durable-conformance-fixture';
import { runCollectedTests } from './browser-vitest-shim';

const workerUrl = (globalThis as { __P04B_WORKER_URL?: string }).__P04B_WORKER_URL ?? '/harness/v2-worker.js';
const sqliteAssetBase = (globalThis as { __P04B_SQLITE_BASE?: string }).__P04B_SQLITE_BASE ?? '/pkg';

runRepositoryConformanceSuite(createDurableConformanceFixture({ workerUrl, sqliteAssetBase }));

export { runCollectedTests };
