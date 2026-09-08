/**
 * P04-A-FIX-01 real-candidate experiment (Chromium via Playwright).
 *
 * Executes SQL through the pinned SQLite-compatible VFS candidates in a
 * served local origin, each inside a dedicated Worker:
 * - IDB candidate: @journeyapps/wa-sqlite async build + IDBBatchAtomicVFS.
 * - OPFS candidate: @journeyapps/wa-sqlite sync build + OPFSCoopSyncVFS.
 *
 * Per candidate and scenario size (small 50, larger 2,000 synthetic rows):
 * 5 cold + 5 warm repetitions of open/schema, single-transaction bulk
 * commit, single-row atomic commits, and readback. Plus, per candidate:
 * close/reload/reopen, in-worker blocking/guarded contention, TRUE TWO-TAB
 * competing guarded writes (two same-origin pages, each with its own
 * Worker/VFS/SQLite connection, both attempting a revision-guarded write
 * from the same starting revision behind an explicit barrier; OPFS overlap
 * accepts only measured NoModificationAllowedError then guarded retry),
 * actual Worker termination during a parked storage transaction with
 * reopen recovery, THREE controlled storage-boundary fault trials
 * (jSync IOERR_FSYNC, seeded base, fresh connection verification), and
 * quota context. OPFS additionally runs the P03 overlay proof (real narrow
 * commands with full-envelope and delivery checks inside one SQLite
 * transaction, verified after reopen).
 *
 * Loudness contract: any required scenario that goes unexecuted, or any
 * unexpected storage outcome (silent overwrite, leaked fault rows on the
 * standing candidate, parked row surviving termination, reopen mismatch,
 * unrelated two-tab error), fails the run with a named reason. IDB leak
 * classification is proven by an isolated fault-probe process that exits
 * nonzero on any leaked rows; this parent passes only when that probe
 * records the exact expected IDB leak from a unique-token child payload
 * and OPFS leaked zero rows under the closed jSync classification. A FAILED
 * fault gate demotes that candidate out of the provisional default
 * (loudly recorded, never relaxed). Gaps are DATA with reasons, never
 * silent passes.
 */
/* global URL: false, Worker: false, clearTimeout: false, setTimeout: false, window: false, process: false, navigator: false, console: false */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { chromium } from 'playwright';
import {
  EXPECTED_IDB_LEAK,
  EXPECTED_OPFS_FAULT,
  IDB_PROBE_SCHEMA,
  IDB_PROBE_SCHEMA_VERSION,
  acceptIdbProbeEvidence,
  createIdbProbeInvocation,
  opfsFaultClassificationMismatch,
} from './idb-fault-probe-contract.mjs';

const ROOT = '/Users/mehmet/Desktop/Rushd';
const RAW_DIR = 'artifacts/agent-reports/p04a-raw';
const RAW_PATH = `${RAW_DIR}/candidate-experiment.json`;
const BUNDLE_PATH = `${RAW_DIR}/command-entry.bundle.mjs`;
const SIZES = { small: 50, large: 2000 };
const REPS = 5;
const SINGLES_PER_REP = 20;

const failures = [];
function requireScenario(condition, label) {
  if (!condition) failures.push(label);
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { n: sorted.length, min: sorted[0], median, max: sorted[sorted.length - 1] };
}

const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><body>p04a-fix01</body></html>');
        return;
      }
      if (url.pathname.startsWith('/harness/')) {
        const data = await readFile(join(ROOT, 'tests/data/workers', url.pathname.slice(9)));
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(data);
        return;
      }
      if (url.pathname.startsWith('/pkg/')) {
        const file = join(ROOT, 'node_modules/@journeyapps/wa-sqlite', url.pathname.slice(5));
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(data);
        return;
      }
      if (url.pathname.startsWith('/raw/')) {
        const data = await readFile(join(ROOT, RAW_DIR, url.pathname.slice(5)));
        res.writeHead(200, { 'Content-Type': MIME[extname(url.pathname)] || 'application/octet-stream' });
        res.end(data);
        return;
      }
      res.writeHead(404);
      res.end('not found');
    } catch (error) {
      res.writeHead(404);
      res.end(String(error));
    }
  });
  return server;
}

async function buildCommandBundle() {
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    'tests/data/worker-command-entry.ts',
    '--bundle',
    '--format=esm',
    '--platform=browser',
    `--outfile=${BUNDLE_PATH}`,
  ], { cwd: ROOT, stdio: 'pipe' });
}

async function installPageHarness(page) {
  await page.evaluate(() => {
    const registry = {
      seq: 1,
      workers: new Map(),
      parkWaiters: new Map(),
      spawn(url) {
        const wid = `w${this.workers.size + 1}`;
        const worker = new Worker(url, { type: 'module' });
        worker.onmessage = (event) => {
          const msg = event.data;
          if (msg && msg.parked === true) {
            const waiter = this.parkWaiters.get(wid);
            if (waiter) {
              this.parkWaiters.delete(wid);
              waiter();
            }
            return;
          }
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            clearTimeout(pending.timer);
            if (msg.ok) pending.resolve(msg.result);
            else pending.reject(new Error(msg.error));
          }
        };
        worker.onerror = (event) => {
          for (const [id, pending] of this.pending) {
            if (pending.wid === wid) {
              this.pending.delete(id);
              clearTimeout(pending.timer);
              pending.reject(new Error(`worker ${wid} error: ${event.message}`));
            }
          }
        };
        this.workers.set(wid, worker);
        return wid;
      },
      pending: new Map(),
      call(wid, op, params, timeoutMs) {
        const worker = this.workers.get(wid);
        if (!worker) throw new Error(`unknown worker ${wid}`);
        return new Promise((resolve, reject) => {
          const id = this.seq;
          this.seq += 1;
          const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`op timeout: ${op} after ${timeoutMs}ms`));
          }, timeoutMs);
          this.pending.set(id, { resolve, reject, timer, wid });
          worker.postMessage({ id, op, params });
        });
      },
      waitPark(wid, timeoutMs) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this.parkWaiters.delete(wid);
            reject(new Error(`park ack timeout after ${timeoutMs}ms`));
          }, timeoutMs);
          this.parkWaiters.set(wid, () => {
            clearTimeout(timer);
            resolve(true);
          });
        });
      },
      terminate(wid) {
        const worker = this.workers.get(wid);
        if (worker) {
          worker.terminate();
          this.workers.delete(wid);
        }
      },
    };
    window.__p04a = registry;
  });
}

async function rpc(page, wid, op, params = {}, timeoutMs = 90000) {
  return page.evaluate(({ w, o, p, t }) => window.__p04a.call(w, o, p, t), { w: wid, o: op, p: params, t: timeoutMs });
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function isAcceptedLoser(outcome) {
  const text = String(outcome ?? '');
  return text === 'stale-guard-detected-rollback'
    || text.startsWith('busy-like:')
    || text.startsWith('guard-conflict:');
}

function isMeasuredOpfsOverlapRefusal(openResult) {
  if (!openResult || openResult.opened !== false) return false;
  const blob = `${openResult.errorName || ''} ${openResult.errorMessage || ''}`;
  return blob.includes('NoModificationAllowedError') && blob.includes('createSyncAccessHandle');
}

async function startGuardedAttempt(tab, wid, params) {
  return tab.evaluate(({ w, p }) => {
    window.__guardAttemptSettled = 'pending';
    window.__guardAttempt = window.__p04a.call(w, 'tAttemptGuardedWrite', p, 120000).then(
      (value) => {
        window.__guardAttemptSettled = 'resolved';
        return { resolved: value };
      },
      (error) => {
        window.__guardAttemptSettled = 'errored';
        return { error: String(error && error.message ? error.message : error).slice(0, 400) };
      },
    );
    return 'started';
  }, { w: wid, p: params });
}

async function awaitGuardedAttempt(tab, timeoutMs = 120000) {
  return tab.evaluate((limit) => Promise.race([
    window.__guardAttempt,
    new Promise((_, reject) => setTimeout(() => reject(new Error('guarded write never completed')), limit)),
  ]), timeoutMs);
}

function recordCompetingOutcomes(configId, cand, resultA, resultB) {
  cand.twoTab.attemptA = resultA;
  cand.twoTab.attemptB = resultB;
  if (!resultA || resultA.error || !resultB || resultB.error) {
    requireScenario(false, `${configId}: two-tab RPC error A=${resultA && resultA.error ? resultA.error : 'ok'} B=${resultB && resultB.error ? resultB.error : 'ok'}`);
    return;
  }
  const attemptA = resultA.resolved;
  const attemptB = resultB.resolved;
  const aWin = Boolean(attemptA && attemptA.committed === true);
  const bWin = Boolean(attemptB && attemptB.committed === true);
  requireScenario(aWin !== bWin, `${configId}: exactly one durable commit (A committed=${aWin} B committed=${bWin})`);
  const winner = aWin ? attemptA : attemptB;
  const loser = aWin ? attemptB : attemptA;
  requireScenario(Boolean(winner && winner.outcome === 'committed'), `${configId}: winner outcome committed (got ${winner && winner.outcome})`);
  requireScenario(Boolean(loser && isAcceptedLoser(loser.outcome)), `${configId}: loser explicit BUSY/stale/guard-conflict (got ${loser && loser.outcome})`);
  cand.twoTab.winner = aWin ? 'tabA' : 'tabB';
  cand.twoTab.winnerWriter = aWin ? 'A' : 'B';
  cand.twoTab.loserOutcome = loser && loser.outcome;
  cand.twoTab.path = 'competing-guarded-writes';
}

function phase(candidate, label) {
  console.error(`[p04a ${candidate}] ${label}`);
}

async function runIdbFaultProbe() {
  const token = readArg('--run-token');
  const outputPath = readArg('--output');
  if (!token || !outputPath) {
    console.error('idb fault probe requires --run-token and --output');
    process.exit(1);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  const startedAt = new Date().toISOString();
  const server = startServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const dbName = 'p04a-idb-fault-probe';
  const trials = [];
  const unexpected = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);
    await installPageHarness(page);
    const spawn = () => page.evaluate((url) => window.__p04a.spawn(url), '/harness/idb-worker.js');
    const drop = (wid) => page.evaluate((w) => window.__p04a.terminate(w), wid);
    for (let trial = 0; trial < 3; trial += 1) {
      phase('idb-probe', `fault trial ${trial}`);
      const trialWid = await spawn();
      await rpc(page, trialWid, 'reset', { name: dbName }, 120000);
      const seed = await rpc(page, trialWid, 'bulk', { name: dbName, tag: 'seedbase', count: 50, bookId: 'seedbase' }, 120000);
      if (seed.count !== 50) unexpected.push(`trial${trial}:seed-${seed.count}`);
      const injection = await rpc(page, trialWid, 'inject', { name: dbName }, 120000);
      await drop(trialWid);
      const verifyWid = await spawn();
      await rpc(page, verifyWid, 'open', { name: dbName }, 120000);
      const faultProof = await rpc(page, verifyWid, 'verifyFault', { name: dbName }, 60000);
      await drop(verifyWid);
      const row = { trial, ...injection, ...faultProof, reopened: true };
      trials.push(row);
      if (row.fired !== 1) unexpected.push(`trial${trial}:fired-${row.fired}`);
      if (row.fault === null) unexpected.push(`trial${trial}:missing-fault`);
      if (row.integrity !== 'ok') unexpected.push(`trial${trial}:integrity-${row.integrity}`);
    }
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  const leaked = trials.some((trial) => Number(trial.leakedFaultRows) > 0);
  const payload = {
    schema: IDB_PROBE_SCHEMA,
    schemaVersion: IDB_PROBE_SCHEMA_VERSION,
    runToken: token,
    startedAt,
    completedAt: new Date().toISOString(),
    exitReason: unexpected.length > 0 ? 'unexpected-error' : (leaked ? 'leaked-rows' : 'no-leak'),
    unexpected,
    leaked,
    trials,
  };
  writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  console.error(`idb fault probe raw results: ${outputPath} reason=${payload.exitReason} token=${token}`);
  if (unexpected.length > 0 || leaked) {
    console.error(`idb fault probe exiting nonzero (${payload.exitReason})`);
    for (const item of unexpected) console.error(`- ${item}`);
    for (const trial of trials) {
      console.error(`- trial ${trial.trial}: leaked=${trial.leakedFaultRows} rows ${trial.rowsBefore}->${trial.rowsAfter} fired=${trial.fired} fault=${trial.fault}`);
    }
    process.exit(1);
  }
  console.error('idb fault probe observed zero leaked rows');
  process.exit(0);
}

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  buildCommandBundle();
  const result = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    packages: {
      waSqlite: JSON.parse(await readFile(join(ROOT, 'node_modules/@journeyapps/wa-sqlite/package.json'), 'utf8')).version,
      sqliteWasm: JSON.parse(await readFile(join(ROOT, 'node_modules/@sqlite.org/sqlite-wasm/package.json'), 'utf8')).version,
    },
    device: { platform: process.platform, arch: process.arch },
    browser: {},
    candidates: {},
    crossCandidateSums: {},
    untested: [
      'samsung-galaxy-a55-android-chrome',
      'ipad-pro-m4-ipados-safari',
      'mac-desktop-safari',
      'iphone-ios-unconfirmed',
      'private-mode-quota-matrix',
    ],
  };

  const server = startServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const bundleUrl = `${origin}/raw/command-entry.bundle.mjs`;
  const browser = await chromium.launch();
  try {
    result.browser.chromiumVersion = browser.version();
    const probeContext = await browser.newContext();
    const probePage = await probeContext.newPage();
    await probePage.goto(origin);
    result.browser.userAgent = await probePage.evaluate(() => navigator.userAgent);
    await probeContext.close();

    const configs = [
      { id: 'idb', workerUrl: '/harness/idb-worker.js', dbName: 'p04a-idb-bench' },
      { id: 'opfs', workerUrl: '/harness/opfs-worker.js', dbName: 'p04a-opfs-bench' },
    ];

    for (const config of configs) {
      phase(config.id, 'candidate start');
      const cand = { worker: config.workerUrl, reps: {}, reload: null, contention: null, termination: null, injection: null, quota: null, sqliteVersion: null };
      result.candidates[config.id] = cand;
      const candidateContext = await browser.newContext();
      const page = await candidateContext.newPage();
      await page.goto(origin);
      await installPageHarness(page);
      const spawn = () => page.evaluate((url) => window.__p04a.spawn(url), config.workerUrl);
      const drop = (wid) => page.evaluate((w) => window.__p04a.terminate(w), wid);
      // Tab workers live in their own page's registry: terminate them there.
      const dropOn = (tab, wid) => tab.evaluate((w) => window.__p04a.terminate(w), wid);

      for (const sizeId of Object.keys(SIZES)) {
        const count = SIZES[sizeId];
        const cold = [];
        for (let rep = 0; rep < REPS; rep += 1) {
          // Cold: fresh worker, fresh file, fresh engine caches.
          const wid = await spawn();
          const reset = await rpc(page, wid, 'reset', { name: config.dbName }, 120000);
          if (cand.sqliteVersion === null) cand.sqliteVersion = reset.version;
          requireScenario(reset.version === '3.53.0', `${config.id}/${sizeId}/rep${rep}: sqlite engine version`);
          const bulk = await rpc(page, wid, 'bulk', { name: config.dbName, tag: sizeId, count, bookId: `bench-${sizeId}` }, 180000);
          const singles = await rpc(page, wid, 'commits', { name: config.dbName, n: SINGLES_PER_REP, tag: sizeId, bookId: `bench-${sizeId}` }, 120000);
          const read = await rpc(page, wid, 'read', { name: config.dbName }, 60000);
          requireScenario(read.count === count + SINGLES_PER_REP, `${config.id}/${sizeId}/cold-rep${rep}: row count`);
          cold.push({ resetMs: reset.resetMs, bulkMs: bulk.bulkMs, commitsMs: singles.commitsMs, perCommitMs: singles.perCommitMs, readMs: read.readMs, count: read.count, sum: read.sum });
          await drop(wid);
        }
        // Warm: one worker, existing file, truncate between reps.
        const warmWid = await spawn();
        await rpc(page, warmWid, 'open', { name: config.dbName }, 120000);
        const warm = [];
        for (let rep = 0; rep < REPS; rep += 1) {
          const trunc = await rpc(page, warmWid, 'truncate', { name: config.dbName }, 60000);
          const bulk = await rpc(page, warmWid, 'bulk', { name: config.dbName, tag: sizeId, count, bookId: `bench-${sizeId}` }, 180000);
          const singles = await rpc(page, warmWid, 'commits', { name: config.dbName, n: SINGLES_PER_REP, tag: sizeId, bookId: `bench-${sizeId}` }, 120000);
          const read = await rpc(page, warmWid, 'read', { name: config.dbName }, 60000);
          requireScenario(read.count === count + SINGLES_PER_REP, `${config.id}/${sizeId}/warm-rep${rep}: row count`);
          warm.push({ truncateMs: trunc.truncateMs, bulkMs: bulk.bulkMs, commitsMs: singles.commitsMs, perCommitMs: singles.perCommitMs, readMs: read.readMs, count: read.count, sum: read.sum });
        }
        const summarize = (runs) => ({
          runs,
          bulkMs: stats(runs.map((r) => r.bulkMs)),
          perCommitMs: stats(runs.map((r) => r.perCommitMs)),
          readMs: stats(runs.map((r) => r.readMs)),
        });
        cand.reps[sizeId] = { entries: count, singlesPerRep: SINGLES_PER_REP, cold: summarize(cold), warm: summarize(warm) };

        if (sizeId === 'small') {
          // Reload on the warm worker's populated database.
          const reload = await rpc(page, warmWid, 'reload', { name: config.dbName }, 120000);
          requireScenario(reload.count === count + SINGLES_PER_REP, `${config.id}: reload preserves rows`);
          cand.reload = reload;
        }
        await drop(warmWid);
      }

      // Fault scenarios each get a dedicated worker on a clean database.
      // Blocking: a second concurrent writer must not fail fast or
      // overwrite; it blocks (IDB) or follows cooperative rules (OPFS).
      // The worker is terminated while both transactions are pending, so
      // recovery is verified on reopen with no commit/rollback issued.
      const blockWid = await spawn();
      await rpc(page, blockWid, 'open', { name: config.dbName }, 120000);
      const blocking = await rpc(page, blockWid, 'blocking', { name: config.dbName }, 120000);
      cand.blocking = blocking;
      // Per-candidate measured behavior (pinned, not assumed): IDB
      // serializes concurrent writers by blocking; OPFSCoopSyncVFS lets the
      // second BEGIN through and defers the conflict to guard/commit time
      // (proven by `guarded` below). Either deviation fails loudly.
      if (config.id === 'idb') {
        requireScenario(blocking.bBlockedAt3s === true && blocking.bEarlyError === null,
          `idb: second writer blocked (blocked=${blocking.bBlockedAt3s}, early=${blocking.bEarlyError})`);
      } else {
        requireScenario(blocking.bBlockedAt3s === false && blocking.bEarlyError === null,
          `opfs: second BEGIN resolved early per cooperative model (blocked=${blocking.bBlockedAt3s}, early=${blocking.bEarlyError})`);
      }
      await drop(blockWid);
      const verifyWid = await spawn();
      await rpc(page, verifyWid, 'open', { name: config.dbName }, 120000);
      const clean = await rpc(page, verifyWid, 'verifyClean', { name: config.dbName }, 60000);
      cand.blockRecovery = clean;
      requireScenario(clean.blockRows === 0, `${config.id}: uncommitted blocked row absent after termination`);
      requireScenario(clean.integrity === 'ok', `${config.id}: integrity after blocked-writer termination`);
      await drop(verifyWid);

      const guardWid = await spawn();
      await rpc(page, guardWid, 'reset', { name: config.dbName }, 120000);
      const guarded = await rpc(page, guardWid, 'guarded', { name: config.dbName }, 120000);
      cand.guarded = guarded;
      requireScenario(guarded.finalRevision === 8, `${config.id}: guarded final revision`);
      requireScenario(guarded.winnerRows === 1, `${config.id}: winner row intact`);
      const loserOutcome = String(guarded.bOutcome ?? '');
      requireScenario(
        loserOutcome === 'stale-guard-detected-rollback'
          || loserOutcome.startsWith('busy-like:')
          || (loserOutcome.startsWith('stale-write-committed-or-failed') && loserOutcome.includes('commit-failed')),
        `${config.id}: loser detected conflict without silent overwrite (got ${loserOutcome})`,
      );
      await drop(guardWid);

      // True two-tab competing guarded-write proof: two same-origin pages,
      // each with its own Worker, VFS, and SQLite connection on the same
      // database. Both read revision 7, then both attempt a revision-guarded
      // write from that starting revision behind an explicit barrier. A
      // transaction that only reads before termination is not a competing
      // write. OPFS overlap accepts only the measured
      // NoModificationAllowedError from createSyncAccessHandle, then the
      // holder commits a real guarded write and the loser retries that same
      // revision-7 write; any other open/permission/runtime error fails.
      const tabA = await candidateContext.newPage();
      await tabA.goto(origin);
      await installPageHarness(tabA);
      const tabB = await candidateContext.newPage();
      await tabB.goto(origin);
      await installPageHarness(tabB);
      const spawnOn = (tab) => tab.evaluate((url) => window.__p04a.spawn(url), config.workerUrl);
      const widA = await spawnOn(tabA);
      const openA = await rpc(tabA, widA, 'openMeasured', { name: config.dbName }, 120000);
      requireScenario(openA.opened === true, `${config.id}: two-tab A opened (error=${openA.errorName}:${openA.errorMessage})`);
      await rpc(tabA, widA, 'tSeed', { name: config.dbName, revision: 7 }, 60000);
      const revA = await rpc(tabA, widA, 'tReadRevision', { name: config.dbName }, 60000);
      requireScenario(revA.revision === 7, `${config.id}: two-tab A reads base revision 7`);
      const widB = await spawnOn(tabB);
      const openB = await rpc(tabB, widB, 'openMeasured', { name: config.dbName }, 120000);
      cand.twoTab = { openA, openB };
      if (openB.opened === true) {
        const revB = await rpc(tabB, widB, 'tReadRevision', { name: config.dbName }, 60000);
        requireScenario(revB.revision === 7, `${config.id}: two-tab B reads base revision 7`);
        const attemptParams = (writerId, peerId) => ({
          name: config.dbName,
          fromRevision: 7,
          writerId,
          peerId,
          barrier: true,
        });
        await startGuardedAttempt(tabA, widA, attemptParams('A', 'B'));
        await startGuardedAttempt(tabB, widB, attemptParams('B', 'A'));
        cand.twoTab.barrier = 'both-guarded-writes-in-flight';
        const [resultA, resultB] = await Promise.all([
          awaitGuardedAttempt(tabA),
          awaitGuardedAttempt(tabB),
        ]);
        recordCompetingOutcomes(config.id, cand, resultA, resultB);
        await dropOn(tabA, widA);
        await dropOn(tabB, widB);
      } else if (config.id === 'opfs' && isMeasuredOpfsOverlapRefusal(openB)) {
        cand.twoTab.overlapRefusal = {
          errorName: openB.errorName,
          errorMessage: openB.errorMessage,
        };
        const resultA = await rpc(tabA, widA, 'tAttemptGuardedWrite', {
          name: config.dbName,
          fromRevision: 7,
          writerId: 'A',
          peerId: 'B',
          barrier: false,
        }, 120000);
        requireScenario(resultA.committed === true && resultA.outcome === 'committed', `opfs: overlap-holder A committed a guarded write (got ${JSON.stringify(resultA)})`);
        cand.twoTab.attemptA = { resolved: resultA };
        await dropOn(tabA, widA);
        await dropOn(tabB, widB);
        const widB2 = await spawnOn(tabB);
        const openB2 = await rpc(tabB, widB2, 'openMeasured', { name: config.dbName }, 120000);
        requireScenario(openB2.opened === true, `opfs: retry open after measured overlap refusal (error=${openB2.errorName}:${openB2.errorMessage})`);
        const resultB = await rpc(tabB, widB2, 'tAttemptGuardedWrite', {
          name: config.dbName,
          fromRevision: 7,
          writerId: 'B',
          peerId: 'A',
          barrier: false,
        }, 120000);
        requireScenario(resultB.committed === false && isAcceptedLoser(resultB.outcome), `opfs: retry from revision 7 is an explicit loser (got ${JSON.stringify(resultB)})`);
        cand.twoTab.attemptB = { resolved: resultB };
        cand.twoTab.winner = 'tabA';
        cand.twoTab.winnerWriter = 'A';
        cand.twoTab.loserOutcome = resultB.outcome;
        cand.twoTab.path = 'NoModificationAllowedError-then-guarded-retry';
        await dropOn(tabB, widB2);
      } else {
        requireScenario(false, `${config.id}: unexpected two-tab open failure name=${openB.errorName} message=${openB.errorMessage}`);
        await dropOn(tabA, widA);
        await dropOn(tabB, widB);
      }
      const tabC = await candidateContext.newPage();
      await tabC.goto(origin);
      await installPageHarness(tabC);
      const widC = await tabC.evaluate((url) => window.__p04a.spawn(url), config.workerUrl);
      await rpc(tabC, widC, 'open', { name: config.dbName }, 120000);
      const twoTabVerify = await rpc(tabC, widC, 'tVerify', { name: config.dbName }, 60000);
      cand.twoTab.verify = twoTabVerify;
      requireScenario(twoTabVerify.revision === 8, `${config.id}: two-tab final revision exactly 8`);
      requireScenario(twoTabVerify.winnerRows === 1, `${config.id}: two-tab winner row present once`);
      requireScenario(twoTabVerify.integrity === 'ok', `${config.id}: two-tab integrity on fresh-page reopen`);
      if (cand.twoTab.winnerWriter === 'A') {
        requireScenario(twoTabVerify.writerARows === 1 && twoTabVerify.writerBRows === 0, `${config.id}: loser B produced no durable row`);
      } else if (cand.twoTab.winnerWriter === 'B') {
        requireScenario(twoTabVerify.writerBRows === 1 && twoTabVerify.writerARows === 0, `${config.id}: loser A produced no durable row`);
      } else {
        requireScenario(false, `${config.id}: missing two-tab winnerWriter`);
      }
      const begunC = await rpc(tabC, widC, 'tBegin', { name: config.dbName }, 60000);
      const loserC = await rpc(tabC, widC, 'tStale', { key: begunC.key, staleRevision: 7 }, 60000);
      cand.twoTab.loser = loserC;
      requireScenario(loserC.changed === 0 && loserC.outcome === 'stale-guard-detected-rollback', `${config.id}: fresh handle detects stale revision (got ${loserC.outcome})`);
      await dropOn(tabC, widC);
      await tabA.close();
      await tabB.close();
      await tabC.close();

      if (config.id === 'idb') {
        // Isolated negative probe bound to this invocation: unique token
        // and unique output path. The parent never reads idb-fault-probe.json.
        phase(config.id, 'spawn isolated leak probe');
        const invocation = createIdbProbeInvocation(join(ROOT, RAW_DIR));
        requireScenario(!existsSync(invocation.outputPath), `idb: unique probe path must not pre-exist (${invocation.outputPath})`);
        let probe;
        try {
          probe = spawnSync(process.execPath, [
            'tests/data/idb-fault-probe.mjs',
            '--run-token',
            invocation.token,
            '--output',
            invocation.outputPath,
          ], {
            cwd: ROOT,
            encoding: 'utf8',
            env: process.env,
            timeout: 180000,
          });
        } catch (error) {
          probe = { status: null, stdout: '', stderr: String(error && error.stack ? error.stack : error) };
        }
        if (probe.stdout) process.stderr.write(probe.stdout);
        if (probe.stderr) process.stderr.write(probe.stderr);
        const accepted = acceptIdbProbeEvidence({
          outputPath: invocation.outputPath,
          expectedToken: invocation.token,
          startedAtMs: invocation.startedAtMs,
          probeStatus: probe.status,
        });
        if (accepted.ok) {
          const stamp = accepted.payload.completedAt.replace(/[:.]/g, '-');
          copyFileSync(invocation.outputPath, join(ROOT, RAW_DIR, `idb-fault-probe-${stamp}.json`));
        }
        cand.injection = {
          source: 'isolated-idb-fault-probe',
          probeExit: probe.status,
          probeOutputPath: invocation.outputPath,
          runToken: invocation.token,
          trials: accepted.payload && accepted.payload.trials ? accepted.payload.trials : [],
          exitReason: accepted.payload && accepted.payload.exitReason,
          faultGate: 'FAILED',
          expectedLeak: EXPECTED_IDB_LEAK,
          acceptReason: accepted.reason,
        };
        requireScenario(accepted.ok, `idb: bound probe evidence accepted (got ${accepted.reason})`);
        cand.status = 'FAILED-fault-gate';
        console.error('[idb] FAULT GATE FAILED — isolated probe recorded commit despite injected sync failure; candidate demoted out of the provisional default.');
      } else {
        // Standing-candidate fault trials: closed classification. Any leak,
        // missing fire, unrelated error, or wrong seed/row count fails.
        const faultTrials = [];
        for (let trial = 0; trial < 3; trial += 1) {
          phase(config.id, `fault trial ${trial}`);
          const trialWid = await spawn();
          await rpc(page, trialWid, 'reset', { name: config.dbName }, 120000);
          const seed = await rpc(page, trialWid, 'bulk', { name: config.dbName, tag: 'seedbase', count: 50, bookId: 'seedbase' }, 120000);
          requireScenario(seed.count === 50, `${config.id}: fault trial ${trial} seeded 50 rows`);
          const injection = await rpc(page, trialWid, 'inject', { name: config.dbName }, 120000);
          await drop(trialWid);
          const verifyTrialWid = await spawn();
          await rpc(page, verifyTrialWid, 'open', { name: config.dbName }, 120000);
          const faultProof = await rpc(page, verifyTrialWid, 'verifyFault', { name: config.dbName }, 60000);
          await drop(verifyTrialWid);
          const row = { trial, ...injection, ...faultProof, reopened: true };
          faultTrials.push(row);
          const mismatch = opfsFaultClassificationMismatch(row);
          requireScenario(mismatch === null, `${config.id}: fault trial ${trial} closed classification (got ${mismatch}; method=${row.method} fired=${row.fired} fault=${row.fault} rows=${row.rowsBefore}->${row.rowsAfter} leaked=${row.leakedFaultRows} integrity=${row.integrity})`);
        }
        const faultGate = faultTrials.every((t) => opfsFaultClassificationMismatch(t) === null)
          ? 'pass'
          : 'FAILED';
        cand.injection = { trials: faultTrials, faultGate, expected: EXPECTED_OPFS_FAULT };
        cand.status = faultGate === 'pass' ? 'provisional' : 'FAILED-fault-gate';
        if (faultGate !== 'pass') {
          console.error(`[${config.id}] FAULT GATE FAILED — leak recorded in trials above; candidate demoted out of the provisional default.`);
        }
      }

      // Terminated worker: park a transaction, kill the worker, reopen.
      const parkWid = await spawn();
      await rpc(page, parkWid, 'open', { name: config.dbName }, 120000);
      await page.evaluate(({ w, name }) => {
        window.__p04a.workers.get(w).postMessage({ id: -1, op: 'park', params: { name } });
        return window.__p04a.waitPark(w, 60000);
      }, { w: parkWid, name: config.dbName });
      await new Promise((r) => setTimeout(r, 300));
      await page.evaluate((w) => window.__p04a.terminate(w), parkWid);
      const reopenWid = await spawn();
      await rpc(page, reopenWid, 'open', { name: config.dbName }, 120000);
      const parked = await rpc(page, reopenWid, 'checkParked', { name: config.dbName }, 60000);
      cand.termination = { parkedAck: true, ...parked };
      requireScenario(parked.parkedRows === 0, `${config.id}: parked row absent after termination`);
      requireScenario(parked.integrity === 'ok', `${config.id}: integrity after termination`);
      await drop(reopenWid);

      const tailWid = await spawn();
      await rpc(page, tailWid, 'open', { name: config.dbName }, 120000);
      cand.quota = await rpc(page, tailWid, 'quota', {}, 30000);
      await rpc(page, tailWid, 'close', { name: config.dbName }, 60000);
      await drop(tailWid);

      if (config.id === 'opfs') {
        const proofWid = await spawn();
        const proof = await rpc(page, proofWid, 'p03proof', { name: config.dbName, deviceId: 'p04a-device-0001', bundleUrl }, 120000);
        cand.p03proof = proof;
        requireScenario(proof.receipts.length === 5, 'opfs: five command receipts');
        requireScenario(proof.entryCount === 3, 'opfs: three committed inflows');
        requireScenario(proof.outboxLength === 5, 'opfs: five outbox intents');
        requireScenario(Array.isArray(proof.envelopeCheck) && proof.envelopeCheck.length === 14, 'opfs: fourteen envelope field comparisons executed');
        requireScenario(proof.deliveryCheck && proof.deliveryCheck.version === 1 && proof.deliveryCheck.attempts === 1, 'opfs: delivery recorded once from the complete envelope');
        requireScenario(proof.deliveryCheck && typeof proof.deliveryCheck.outboxId === 'string' && proof.deliveryCheck.outboxId.length > 0, 'opfs: delivery linked to the envelope outboxId');
        requireScenario(proof.reopenEqual === true, 'opfs: digest identical after close/reopen');
        await drop(proofWid);
      }
      await candidateContext.close();
    }

    // Provisional default = candidates whose isolated/standing fault gate
    // passed. IDB is expected to fail that gate via the leak probe; OPFS
    // must pass with zero leaked rows. The parent is green only if the
    // default is non-empty, holds OPFS, excludes every FAILED candidate,
    // and the IDB probe matched the exact expected leak classification.

    const defaultIds = configs
      .filter((c) => result.candidates[c.id].injection.faultGate === 'pass')
      .map((c) => c.id);
    result.provisionalDefault = defaultIds;
    requireScenario(defaultIds.length > 0, 'provisional default is non-empty');
    requireScenario(defaultIds.includes('opfs'), 'opfs holds the provisional default');
    for (const c of configs) {
      const gate = result.candidates[c.id].injection.faultGate;
      requireScenario(
        gate === 'pass' ? defaultIds.includes(c.id) : !defaultIds.includes(c.id),
        `${c.id}: classification matches evidence (gate=${gate}, default=${JSON.stringify(defaultIds)})`,
      );
    }
    if (!defaultIds.includes('idb')) {
      console.error('[idb] removed from the provisional default: committed despite injected sync failure. Task B default is OPFS-only pending physical devices.');
    }

    for (const sizeId of Object.keys(SIZES)) {
      const sums = {};
      for (const config of configs) {
        const rep = result.candidates[config.id].reps[sizeId];
        sums[config.id] = { coldSum: rep.cold.runs[0].sum, warmSum: rep.warm.runs[0].sum };
      }
      result.crossCandidateSums[sizeId] = sums;
      requireScenario(sums.idb.coldSum === sums.opfs.coldSum, `cross-candidate sum match (${sizeId})`);
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  writeFileSync(RAW_PATH, JSON.stringify(result, null, 2), 'utf8');
  // Timestamped copy per run so repeated gate runs stay separately visible.
  const stamp = result.generatedAt.replace(/[:.]/g, '-');
  writeFileSync(`${RAW_DIR}/candidate-experiment-${stamp}.json`, JSON.stringify(result, null, 2), 'utf8');
  console.log(`candidate experiment raw results: ${RAW_PATH}`);
  if (failures.length > 0) {
    console.error(`REQUIRED SCENARIOS FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('all required candidate scenarios executed with expected storage outcomes');
}

const run = process.argv.includes('--idb-fault-probe') ? runIdbFaultProbe : main;
run().catch((error) => {
  console.error(`candidate experiment harness failure: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
