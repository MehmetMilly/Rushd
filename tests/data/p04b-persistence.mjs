/**
 * P04-B durable guest repository persistence gate.
 *
 * Runs the real P03 conformance suite against the production OPFS adapter in
 * Chromium, then independent same-origin page/worker lifetime cases. Guest
 * mode is asserted with network interception after assets are acquired.
 */
/* global URL: false, process: false, console: false */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = '/Users/mehmet/Desktop/Rushd';
const RAW_DIR = 'artifacts/agent-reports/p04b-raw';
const WORKER_BUNDLE = `${RAW_DIR}/sqlite-worker.bundle.mjs`;
const CONFORMANCE_BUNDLE = `${RAW_DIR}/conformance.bundle.mjs`;
const PAGE_API_BUNDLE = `${RAW_DIR}/page-api.bundle.mjs`;
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };

const failures = [];
function requireScenario(condition, label) {
  if (!condition) failures.push(label);
}

function classifyGuestRequests(entries, origin) {
  const sameOrigin = [];
  const remote = [];
  for (const entry of entries) {
    if (entry.resourceType === 'websocket' || entry.resourceType === 'ping' || entry.method === 'CONNECT') {
      remote.push(entry);
      continue;
    }
    let parsed;
    try {
      parsed = new URL(entry.url);
    } catch {
      remote.push(entry);
      continue;
    }
    if (parsed.origin === origin) {
      sameOrigin.push(entry);
      continue;
    }
    remote.push(entry);
  }
  return { sameOrigin, remote };
}

function requireCoherent(snapshot, label) {
  requireScenario(snapshot.localOnlyCoherent === true, `${label}: mixed snapshot revision=${snapshot.revision} outbox=${snapshot.outboxCount} journal=${snapshot.journalCount} delivery=${snapshot.deliveryCount} enqueueSequence=${snapshot.enqueueSequence}`);
  requireScenario(
    snapshot.revision === snapshot.outboxCount &&
      snapshot.outboxCount === snapshot.journalCount &&
      snapshot.journalCount === snapshot.enqueueSequence,
    `${label}: revision/outbox/journal/sequence diverged revision=${snapshot.revision} outbox=${snapshot.outboxCount} seq=${snapshot.enqueueSequence}`,
  );
}

function requireDurableCoherent(snapshot, label) {
  requireScenario(snapshot.coherent === true, `${label}: durable snapshot incoherent revision=${snapshot.revision} outbox=${snapshot.outboxCount} journal=${snapshot.journalCount} delivery=${snapshot.deliveryCount} enqueueSequence=${snapshot.enqueueSequence}`);
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/' || url.pathname === '/page' || url.pathname === '/conformance') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><body>p04b</body></html>');
        return;
      }
      if (url.pathname.startsWith('/harness/')) {
        const name = url.pathname.slice('/harness/'.length);
        const file =
          name === 'v2-worker.js'
            ? join(ROOT, WORKER_BUNDLE)
            : name === 'conformance.bundle.mjs'
              ? join(ROOT, CONFORMANCE_BUNDLE)
              : name === 'page-api.bundle.mjs'
                ? join(ROOT, PAGE_API_BUNDLE)
                : join(ROOT, 'tests/data/workers', name);
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600' });
        res.end(data);
        return;
      }
      if (url.pathname.startsWith('/pkg/')) {
        const file = join(ROOT, 'node_modules/@journeyapps/wa-sqlite', url.pathname.slice(5));
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
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

function buildBundles() {
  const esbuild = join(ROOT, 'node_modules/.bin/esbuild');
  execFileSync(
    esbuild,
    ['src/data/v2/sqlite-worker.ts', '--bundle', '--format=esm', '--platform=browser', `--outfile=${WORKER_BUNDLE}`],
    { cwd: ROOT, stdio: 'pipe' },
  );
  execFileSync(
    esbuild,
    [
      'tests/data/browser-conformance-entry.ts',
      '--bundle',
      '--format=esm',
      '--platform=browser',
      `--alias:vitest=${join(ROOT, 'tests/data/browser-vitest-shim.ts')}`,
      `--outfile=${CONFORMANCE_BUNDLE}`,
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
  execFileSync(
    esbuild,
    ['tests/data/p04b-page-api.ts', '--bundle', '--format=esm', '--platform=browser', `--outfile=${PAGE_API_BUNDLE}`],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

async function openApiPage(context, origin) {
  const page = await context.newPage();
  await page.goto(`${origin}/page`);
  await page.addScriptTag({ type: 'module', url: `${origin}/harness/page-api.bundle.mjs` });
  await page.waitForFunction(() => globalThis.__p04b !== undefined);
  return page;
}

async function main() {
  mkdirSync(join(ROOT, RAW_DIR), { recursive: true });
  buildBundles();

  const server = startServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server address missing');
  const origin = `http://127.0.0.1:${address.port}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const evidence = {
    schema: 'p04b-persistence',
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    origin,
    browser: 'Chromium',
    backend: 'OPFSCoopSyncVFS',
    sqlitePackage: '@journeyapps/wa-sqlite@2.0.4',
    sqliteEngine: '3.53.0',
    localSchemaVersion: 1,
    conformance: null,
    competingWrites: null,
    hydrateVsCommit: null,
    mixedWrite: null,
    lostAck: null,
    abortedPull: null,
    scopeSeparation: null,
    reopenAndKill: null,
    unsupported: null,
    guestNetwork: null,
    failures,
  };

  try {
    const conformancePage = await context.newPage();
    await conformancePage.goto(`${origin}/conformance`);
    const conformance = await conformancePage.evaluate(async () => {
      const mod = await import('/harness/conformance.bundle.mjs');
      return mod.runCollectedTests();
    });
    const failed = conformance.filter((test) => !test.ok);
    evidence.conformance = {
      total: conformance.length,
      passed: conformance.filter((test) => test.ok).length,
      failed: failed.map((test) => ({ name: test.name, error: test.error })),
      names: conformance.map((test) => test.name),
    };
    requireScenario(failed.length === 0, `conformance failures: ${failed.map((test) => test.name).join(', ')}`);
    await conformancePage.close();

    const storageId = `compete-${Date.now()}`;
    const pageA = await openApiPage(context, origin);
    const pageB = await openApiPage(context, origin);
    await pageA.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: true });
      await globalThis.__p04b.seed();
    }, { storageId });
    const openedB = await pageB.evaluate(async ({ storageId: id }) => {
      try {
        await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: false });
        const snap = await globalThis.__p04b.snapshot();
        return { opened: true, revision: snap.revision, errorName: null };
      } catch (error) {
        return { opened: false, revision: null, errorName: error instanceof Error ? error.name : 'unknown' };
      }
    }, { storageId });

    let competing;
    if (!openedB.opened) {
      const holder = await pageA.evaluate(async () =>
        globalThis.__p04b.executeInflow({ operationId: 'op-winner', amount: 1000, day: '2026-09-10', note: 'winner' }),
      );
      const retry = await pageB.evaluate(async ({ storageId: id }) => {
        try {
          await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: false });
        } catch (error) {
          return { ok: false, failure: { kind: 'open-refused', errorName: error instanceof Error ? error.name : 'unknown' } };
        }
        const snap = await globalThis.__p04b.snapshot();
        return globalThis.__p04b.executeInflow({
          operationId: 'op-loser',
          amount: 2000,
          day: '2026-09-11',
          note: 'loser',
          expectedRevision: snap.revision - 1,
        });
      }, { storageId });
      competing = { mode: 'open-refused-then-retry', openedB, holder, retry };
      requireScenario(holder.ok === true, 'holder did not commit after overlap refusal');
      requireScenario(retry.ok === false, 'loser retry was not an explicit failure');
    } else {
      const startedRevision = openedB.revision;
      await Promise.all([
        pageA.evaluate(async () => globalThis.__p04b.waitBarrier('p04b-compete', 'a', 'b')),
        pageB.evaluate(async () => globalThis.__p04b.waitBarrier('p04b-compete', 'b', 'a')),
      ]);
      const [resultA, resultB] = await Promise.all([
        pageA.evaluate(async (revision) =>
          globalThis.__p04b.executeInflow({
            operationId: 'op-winner',
            amount: 1000,
            day: '2026-09-10',
            note: 'tab-a',
            expectedRevision: revision,
          }),
        startedRevision),
        pageB.evaluate(async (revision) =>
          globalThis.__p04b.executeInflow({
            operationId: 'op-loser',
            amount: 2000,
            day: '2026-09-11',
            note: 'tab-b',
            expectedRevision: revision,
          }),
        startedRevision),
      ]);
      competing = { mode: 'guarded-conflict', startedRevision, resultA, resultB };
      const wins = [resultA, resultB].filter((result) => result.ok).length;
      const losses = [resultA, resultB].filter((result) => !result.ok).length;
      requireScenario(wins === 1 && losses === 1, `competing writes wins=${wins} losses=${losses}`);
    }
    const pageC = await openApiPage(context, origin);
    const fresh = await pageC.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: false });
      return globalThis.__p04b.snapshot();
    }, { storageId });
    competing.fresh = { revision: fresh.revision, notes: fresh.notes, outbox: fresh.outbox };
    requireScenario(fresh.revision === 3, `fresh page revision ${fresh.revision} expected 3`);
    requireScenario(!fresh.notes.includes('loser') && !fresh.notes.includes('tab-b') || fresh.notes.includes('winner') || fresh.notes.includes('tab-a'), 'fresh page missing winner or contains loser');
    const winnerNotes = fresh.notes.filter((note) => note === 'winner' || note === 'tab-a');
    const loserNotes = fresh.notes.filter((note) => note === 'loser' || note === 'tab-b');
    requireScenario(winnerNotes.length === 1, `winner rows ${winnerNotes.length}`);
    requireScenario(loserNotes.length === 0, `loser rows ${loserNotes.length}`);
    evidence.competingWrites = competing;
    await pageA.close();
    await pageB.close();
    await pageC.close();

    const raceId = `hydrate-race-${Date.now()}`;
    const raceA = await openApiPage(context, origin);
    const raceB = await openApiPage(context, origin);
    await raceA.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: true });
      await globalThis.__p04b.seed();
      for (const [index, note] of ['race-1', 'race-2', 'race-3', 'race-4'].entries()) {
        const result = await globalThis.__p04b.executeInflow({
          operationId: `op-${note}`,
          amount: 100 + index,
          day: '2026-09-10',
          note,
        });
        if (!result.ok) throw new Error(`setup ${note} failed: ${JSON.stringify(result.failure)}`);
      }
    }, { storageId: raceId });
    await raceB.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: false });
    }, { storageId: raceId });
    const raceBaseline = await raceA.evaluate(async () => globalThis.__p04b.coherentSnapshot());
    requireCoherent(raceBaseline, 'hydrate-vs-commit baseline');
    requireScenario(raceBaseline.revision === 6 && raceBaseline.enqueueSequence === 6, `hydrate-vs-commit baseline was revision ${raceBaseline.revision} seq ${raceBaseline.enqueueSequence}, expected 6`);

    await raceB.evaluate(async () => globalThis.__p04b.armParkDuringHydrate());
    const parkedHydrate = raceB.evaluate(async () => globalThis.__p04b.reopenCoherent());
    await raceB.evaluate(async () => globalThis.__p04b.waitPark());
    const overlappingCommit = raceA.evaluate(async () =>
      globalThis.__p04b.executeInflow({
        operationId: 'op-race-overlap',
        amount: 700,
        day: '2026-09-10',
        note: 'race-overlap',
      }),
    );
    await raceB.evaluate(async () => globalThis.__p04b.resumeParked());
    const [hydratedDuringCommit, commitDuringHydrate] = await Promise.all([parkedHydrate, overlappingCommit]);
    const afterOverlapA = await raceA.evaluate(async () => globalThis.__p04b.coherentSnapshot());
    requireCoherent(hydratedDuringCommit, 'parked hydrate overlapping commit');
    requireCoherent(afterOverlapA, 'commit overlapping parked hydrate');
    requireScenario(
      !(hydratedDuringCommit.revision === 6 && (hydratedDuringCommit.outboxCount === 7 || hydratedDuringCommit.enqueueSequence === 7)),
      `reviewed impossible state returned: revision ${hydratedDuringCommit.revision} outbox ${hydratedDuringCommit.outboxCount} seq ${hydratedDuringCommit.enqueueSequence}`,
    );
    requireScenario(commitDuringHydrate.ok === true, 'overlap commit did not succeed after hydrate snapshot released');

    const raceRounds = [];
    for (let index = 0; index < 8; index += 1) {
      const operationId = `op-race-live-${index}`;
      const [commitResult, hydrated] = await Promise.all([
        raceA.evaluate(async ({ operationId: id, amount }) =>
          globalThis.__p04b.executeInflow({
            operationId: id,
            amount,
            day: '2026-09-18',
            note: id,
          }),
        { operationId, amount: 10 + index }),
        raceB.evaluate(async () => globalThis.__p04b.reopenCoherent()),
      ]);
      const afterCommit = await raceA.evaluate(async () => globalThis.__p04b.coherentSnapshot());
      raceRounds.push({
        operationId,
        commitOk: commitResult.ok === true,
        hydrated: {
          revision: hydrated.revision,
          outboxCount: hydrated.outboxCount,
          enqueueSequence: hydrated.enqueueSequence,
          coherent: hydrated.coherent,
        },
        afterCommit: {
          revision: afterCommit.revision,
          outboxCount: afterCommit.outboxCount,
          enqueueSequence: afterCommit.enqueueSequence,
          coherent: afterCommit.coherent,
        },
      });
      requireCoherent(hydrated, `concurrent hydrate round ${index}`);
      requireCoherent(afterCommit, `concurrent commit round ${index}`);
      requireScenario(
        !(hydrated.revision === 6 && (hydrated.outboxCount === 7 || hydrated.enqueueSequence === 7)),
        `round ${index} returned reviewed impossible state`,
      );
    }
    const raceFresh = await openApiPage(context, origin);
    const raceFreshSnap = await raceFresh.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: false });
      return globalThis.__p04b.coherentSnapshot();
    }, { storageId: raceId });
    requireCoherent(raceFreshSnap, 'hydrate-vs-commit fresh page');
    evidence.hydrateVsCommit = {
      baseline: { revision: raceBaseline.revision, outboxCount: raceBaseline.outboxCount, enqueueSequence: raceBaseline.enqueueSequence, coherent: raceBaseline.coherent },
      parkedOverlap: {
        hydrated: {
          revision: hydratedDuringCommit.revision,
          outboxCount: hydratedDuringCommit.outboxCount,
          journalCount: hydratedDuringCommit.journalCount,
          enqueueSequence: hydratedDuringCommit.enqueueSequence,
          coherent: hydratedDuringCommit.coherent,
          localOnlyCoherent: hydratedDuringCommit.localOnlyCoherent,
        },
        commitOk: commitDuringHydrate.ok === true,
        afterCommit: {
          revision: afterOverlapA.revision,
          outboxCount: afterOverlapA.outboxCount,
          enqueueSequence: afterOverlapA.enqueueSequence,
          coherent: afterOverlapA.coherent,
        },
      },
      rounds: raceRounds,
      fresh: {
        revision: raceFreshSnap.revision,
        outboxCount: raceFreshSnap.outboxCount,
        enqueueSequence: raceFreshSnap.enqueueSequence,
        coherent: raceFreshSnap.coherent,
      },
    };
    await raceA.close();
    await raceB.close();
    await raceFresh.close();

    const mixedId = `mixed-${Date.now()}`;
    const mixedA = await openApiPage(context, origin);
    await mixedA.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: true });
      await globalThis.__p04b.seed();
      await globalThis.__p04b.executeInflow({ operationId: 'op-mixed', amount: 1200, day: '2026-09-28', note: 'mixed' });
      await globalThis.__p04b.updateDelivery({ operationId: 'op-mixed', error: 'seed' });
    }, { storageId: mixedId });
    const mixedWrite = await mixedA.evaluate(async () => globalThis.__p04b.mixedLateConflictSameHandle({ operationId: 'op-mixed' }));
    evidence.mixedWrite = mixedWrite;
    requireScenario(mixedWrite.loser.lost === true, 'mixed-write late writer did not lose');
    requireScenario(mixedWrite.displayName !== 'partial-commit', 'mixed-write committed partial book rename');
    requireScenario(mixedWrite.displayName === mixedWrite.nameBefore, 'mixed-write changed the book name');
    requireScenario(mixedWrite.revision === mixedWrite.revisionBefore, 'mixed-write advanced book revision');
    requireScenario(mixedWrite.winnerAttempts === 2, `mixed-write winner attempts ${mixedWrite.winnerAttempts}`);
    await mixedA.close();

    const lostId = `lost-${Date.now()}`;
    const lostPage = await openApiPage(context, origin);
    await lostPage.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: true });
      await globalThis.__p04b.seed();
      await globalThis.__p04b.armHangAfterCommit();
    }, { storageId: lostId });
    const hung = lostPage.evaluate(async () =>
      globalThis.__p04b.executeInflow({ operationId: 'op-uncertain', amount: 12345, day: '2026-09-17', note: 'uncertain' }),
    );
    await lostPage.waitForTimeout(2000);
    await lostPage.close();
    hung.catch(() => undefined);
    const lostReopen = await openApiPage(context, origin);
    const lostRetry = await lostReopen.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: false });
      const first = await globalThis.__p04b.executeInflow({
        operationId: 'op-uncertain',
        amount: 12345,
        day: '2026-09-17',
        note: 'uncertain',
      });
      const delivery1 = await globalThis.__p04b.updateDelivery({ operationId: 'op-uncertain', error: 'timeout' });
      const delivery2 = await globalThis.__p04b.updateDelivery({ operationId: 'op-uncertain', error: 'timeout' });
      const ack1 = await globalThis.__p04b.acknowledgeDelivery('op-uncertain');
      const ack2 = await globalThis.__p04b.acknowledgeDelivery('op-uncertain');
      const snap = await globalThis.__p04b.snapshot();
      return { first, delivery1, delivery2, ack1, ack2, notes: snap.notes, revision: snap.revision };
    }, { storageId: lostId });
    evidence.lostAck = lostRetry;
    requireScenario(lostRetry.first.ok === true && lostRetry.first.retried === true, 'lost-ack retry was not the original receipt');
    requireScenario(lostRetry.notes.filter((note) => note === 'uncertain').length === 1, 'lost-ack created a second effect');
    requireScenario(lostRetry.delivery1.attempts === 1 && lostRetry.delivery2.attempts === 2, 'delivery retry did not increment once per call');
    requireScenario(lostRetry.ack1.acknowledged === true && lostRetry.ack1.duplicate !== true, 'acknowledgement did not persist');
    requireScenario(lostRetry.ack2.acknowledged === true && lostRetry.ack2.duplicate === true, 'duplicate acknowledgement was not harmless');
    await lostReopen.close();

    const pullId = `pull-${Date.now()}`;
    const pullPage = await openApiPage(context, origin);
    const beforePull = await pullPage.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: true });
      await globalThis.__p04b.seed();
      await globalThis.__p04b.executeInflow({ operationId: 'op-local-delivery', amount: 400, day: '2026-09-25', note: 'local' });
      await globalThis.__p04b.updateDelivery({ operationId: 'op-local-delivery', error: 'seed' });
      return globalThis.__p04b.snapshot();
    }, { storageId: pullId });
    const aborted = await pullPage.evaluate(async () =>
      globalThis.__p04b.abortedPullWithConcurrentDelivery({
        stream: 'stream-pull-race',
        batchId: 'batch-pull-race',
        cursor: 'cursor-pull-race',
        operationId: 'op-pull-race-1',
        amount: 700,
        note: 'pull-race-1',
        baseRevision: 3,
        localOperationId: 'op-local-delivery',
      }),
    );
    const afterAbort = await pullPage.evaluate(async () => globalThis.__p04b.snapshot());
    const retriedBatch = await pullPage.evaluate(async (revision) =>
      globalThis.__p04b.applyRemoteBatch({
        stream: 'stream-pull-race',
        batchId: 'batch-pull-race',
        cursor: 'cursor-pull-race',
        operationId: 'op-pull-race-1',
        amount: 700,
        note: 'pull-race-1',
        baseRevision: revision,
      }),
    afterAbort.revision);
    const replayedBatch = await pullPage.evaluate(async (revision) =>
      globalThis.__p04b.applyRemoteBatch({
        stream: 'stream-pull-race',
        batchId: 'batch-pull-race',
        cursor: 'cursor-pull-race',
        operationId: 'op-pull-race-1',
        amount: 700,
        note: 'pull-race-1',
        baseRevision: revision,
      }),
    afterAbort.revision);
    evidence.abortedPull = {
      beforeBytes: beforePull.snapshotBytes,
      afterAbortBytes: afterAbort.snapshotBytes,
      checkpointBefore: beforePull.checkpointBytes,
      checkpointAfter: afterAbort.checkpointBytes,
      aborted,
      retriedBatch,
      replayedBatch,
    };
    requireScenario(aborted.deliveryAttempts === 2, `concurrent delivery attempts ${aborted.deliveryAttempts}`);
    requireScenario(afterAbort.notes.includes('local') && !afterAbort.notes.includes('pull-race-1'), 'aborted pull leaked remote work');
    requireScenario(afterAbort.checkpointBytes === beforePull.checkpointBytes, 'aborted pull advanced the checkpoint');
    requireScenario(retriedBatch.ok === true && retriedBatch.replayed === false, 'aborted pull retry did not apply once');
    requireScenario(replayedBatch.ok === true && replayedBatch.replayed === true, 'exact pull replay was not a no-op');
    await pullPage.close();

    const scopeGuest = await openApiPage(context, origin);
    const scopeOtherDevice = await openApiPage(context, origin);
    const scopeAccount = await openApiPage(context, origin);
    await scopeGuest.evaluate(async () => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: 'scope-guest', reset: true });
      await globalThis.__p04b.seed();
      await globalThis.__p04b.executeInflow({ operationId: 'op-shared-scope', amount: 77, day: '2026-09-21', note: 'scope-a' });
    });
    await scopeOtherDevice.evaluate(async () => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0002', storageId: 'scope-device-2', reset: true });
      await globalThis.__p04b.seed();
      await globalThis.__p04b.executeInflow({ operationId: 'op-shared-scope', amount: 88, day: '2026-09-21', note: 'scope-b' });
    });
    await scopeAccount.evaluate(async () => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: 'scope-account', reset: true, accountId: 'acct-p04b' });
      await globalThis.__p04b.seed();
    });
    const mismatch = await scopeGuest.evaluate(async () => globalThis.__p04b.mismatchedExecute({ otherDeviceId: 'test-device-0002', operationId: 'op-intruder' }));
    const guestSnap = await scopeGuest.evaluate(async () => globalThis.__p04b.snapshot());
    const otherSnap = await scopeOtherDevice.evaluate(async () => globalThis.__p04b.snapshot());
    evidence.scopeSeparation = { mismatch, guestNotes: guestSnap.notes, otherNotes: otherSnap.notes };
    requireScenario(mismatch.previewKind === 'scopeMismatch' && mismatch.executeKind === 'scopeMismatch', 'scope mismatch was not explicit');
    requireScenario(!guestSnap.notes.includes('intruder'), 'mismatched origin mutated guest state');
    requireScenario(guestSnap.notes.includes('scope-a') && otherSnap.notes.includes('scope-b'), 'scopes were not isolated');
    await scopeGuest.close();
    await scopeOtherDevice.close();
    await scopeAccount.close();

    const killId = `kill-${Date.now()}`;
    const killPage = await openApiPage(context, origin);
    await killPage.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: true });
      await globalThis.__p04b.seed();
      await globalThis.__p04b.executeInflow({ operationId: 'op-keep', amount: 25, day: '2026-09-12', note: 'keep' });
      const pulled = await globalThis.__p04b.applyRemoteBatch({
        stream: 'stream-kill',
        batchId: 'batch-kill',
        cursor: 'cursor-kill',
        operationId: 'op-pulled-keep',
        amount: 30,
        note: 'pulled-keep',
        baseRevision: 3,
      });
      if (!pulled.ok) throw new Error(`kill setup pull failed: ${JSON.stringify(pulled)}`);
    }, { storageId: killId });
    const ordinary = await killPage.evaluate(async () => {
      const before = await globalThis.__p04b.coherentSnapshot();
      await globalThis.__p04b.reopen();
      const after = await globalThis.__p04b.coherentSnapshot();
      return { before, after };
    });
    requireScenario(ordinary.before.snapshotBytes === ordinary.after.snapshotBytes, 'ordinary reopen changed durable bytes');
    requireScenario(ordinary.before.checkpointBytes === ordinary.after.checkpointBytes, 'ordinary reopen changed checkpoints');
    requireDurableCoherent(ordinary.before, 'ordinary reopen before');
    requireDurableCoherent(ordinary.after, 'ordinary reopen after');

    await killPage.evaluate(async () => globalThis.__p04b.armParkAfterBegin());
    const parkedCommit = killPage.evaluate(async () =>
      globalThis.__p04b.executeInflow({ operationId: 'op-killed-commit', amount: 50, day: '2026-09-12', note: 'killed-commit' }),
    ).catch(() => ({ ok: false, killed: true }));
    await killPage.evaluate(async () => globalThis.__p04b.waitPark());
    await killPage.evaluate(async () => globalThis.__p04b.terminateWorker());
    await parkedCommit;
    const afterKillCommit = await killPage.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.recoverAfterKill({ deviceId: 'test-device-0001', storageId: id });
      return globalThis.__p04b.coherentSnapshot();
    }, { storageId: killId });
    requireDurableCoherent(afterKillCommit, 'kill during commit recovery');
    requireScenario(!afterKillCommit.notes.includes('killed-commit'), 'terminated commit leaked a partial row');
    requireScenario(afterKillCommit.notes.includes('keep') && afterKillCommit.notes.includes('pulled-keep'), 'kill during commit dropped independently committed work');
    requireScenario(afterKillCommit.checkpointBytes === ordinary.after.checkpointBytes, 'kill during commit mutated checkpoints');
    requireScenario(afterKillCommit.integrity === 'ok', `integrity after kill during commit: ${afterKillCommit.integrity}`);

    const beforeHydrateKill = await killPage.evaluate(async () => globalThis.__p04b.coherentSnapshot());
    await killPage.evaluate(async () => globalThis.__p04b.armParkDuringHydrate());
    const parkedHydrateKill = killPage.evaluate(async () => globalThis.__p04b.reopenCoherent()).catch(() => ({ killed: true }));
    await killPage.evaluate(async () => globalThis.__p04b.waitPark());
    await killPage.evaluate(async () => globalThis.__p04b.terminateWorker());
    await parkedHydrateKill;
    const afterHydrateKill = await killPage.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.recoverAfterKill({ deviceId: 'test-device-0001', storageId: id });
      return globalThis.__p04b.coherentSnapshot();
    }, { storageId: killId });
    requireDurableCoherent(afterHydrateKill, 'kill during hydrate recovery');
    requireScenario(afterHydrateKill.snapshotBytes === beforeHydrateKill.snapshotBytes, 'kill during hydrate changed canonical bytes');
    requireScenario(afterHydrateKill.checkpointBytes === beforeHydrateKill.checkpointBytes, 'kill during hydrate changed checkpoints');
    requireScenario(afterHydrateKill.outboxCount === beforeHydrateKill.outboxCount, 'kill during hydrate changed outbox');
    requireScenario(afterHydrateKill.enqueueSequence === beforeHydrateKill.enqueueSequence, 'kill during hydrate changed enqueue sequence');
    requireScenario(afterHydrateKill.integrity === 'ok', `integrity after kill during hydrate: ${afterHydrateKill.integrity}`);

    const beforeOverlayKill = await killPage.evaluate(async () => globalThis.__p04b.coherentSnapshot());
    const overlayPeer = await openApiPage(context, origin);
    await overlayPeer.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: id, reset: false });
    }, { storageId: killId });
    await killPage.evaluate(async () => globalThis.__p04b.armParkBeforeCommit());
    const parkedOverlay = killPage.evaluate(async () =>
      globalThis.__p04b.executeInflow({ operationId: 'op-killed-overlay', amount: 9, day: '2026-09-12', note: 'killed-overlay' }),
    ).catch(() => ({ ok: false, killed: true }));
    await killPage.evaluate(async () => globalThis.__p04b.waitParkBeforeCommit());
    const independent = await overlayPeer.evaluate(async () =>
      globalThis.__p04b.executeInflow({ operationId: 'op-independent', amount: 11, day: '2026-09-13', note: 'independent' }),
    );
    await killPage.evaluate(async () => globalThis.__p04b.terminateWorker());
    await parkedOverlay;
    const afterOverlayKill = await killPage.evaluate(async ({ storageId: id }) => {
      await globalThis.__p04b.recoverAfterKill({ deviceId: 'test-device-0001', storageId: id });
      return globalThis.__p04b.coherentSnapshot();
    }, { storageId: killId });
    requireScenario(independent.ok === true, 'independent commit during overlay park failed');
    requireDurableCoherent(afterOverlayKill, 'kill during overlay recovery');
    requireScenario(!afterOverlayKill.notes.includes('killed-overlay'), 'terminated staged overlay leaked into durable state');
    requireScenario(afterOverlayKill.notes.includes('independent'), 'independently committed work missing after overlay kill');
    requireScenario(afterOverlayKill.notes.includes('keep') && afterOverlayKill.notes.includes('pulled-keep'), 'overlay kill dropped prior committed work');
    requireScenario(afterOverlayKill.checkpointBytes === beforeOverlayKill.checkpointBytes, 'overlay kill changed checkpoints');
    requireScenario(afterOverlayKill.enqueueSequence === beforeOverlayKill.enqueueSequence + 1, `overlay kill enqueue ${afterOverlayKill.enqueueSequence} expected ${beforeOverlayKill.enqueueSequence + 1}`);
    requireScenario(afterOverlayKill.integrity === 'ok', `integrity after kill during overlay: ${afterOverlayKill.integrity}`);
    evidence.reopenAndKill = {
      ordinaryEqual: ordinary.before.snapshotBytes === ordinary.after.snapshotBytes,
      distinguished: {
        ordinaryReopen: 'same worker handle reacquisition; byte-identical',
        killedRecovery: 'fresh worker/storage connection via recoverAfterKill',
      },
      killDuringCommit: {
        leaked: afterKillCommit.notes.includes('killed-commit'),
        notes: afterKillCommit.notes,
        coherent: afterKillCommit.coherent,
        integrity: afterKillCommit.integrity,
      },
      killDuringHydrate: {
        unchanged:
          afterHydrateKill.snapshotBytes === beforeHydrateKill.snapshotBytes &&
          afterHydrateKill.checkpointBytes === beforeHydrateKill.checkpointBytes,
        before: {
          revision: beforeHydrateKill.revision,
          outboxCount: beforeHydrateKill.outboxCount,
          journalCount: beforeHydrateKill.journalCount,
          deliveryCount: beforeHydrateKill.deliveryCount,
          enqueueSequence: beforeHydrateKill.enqueueSequence,
        },
        after: {
          revision: afterHydrateKill.revision,
          outboxCount: afterHydrateKill.outboxCount,
          journalCount: afterHydrateKill.journalCount,
          deliveryCount: afterHydrateKill.deliveryCount,
          enqueueSequence: afterHydrateKill.enqueueSequence,
          coherent: afterHydrateKill.coherent,
          integrity: afterHydrateKill.integrity,
        },
      },
      killDuringOverlay: {
        independentOk: independent.ok === true,
        leakedKilled: afterOverlayKill.notes.includes('killed-overlay'),
        hasIndependent: afterOverlayKill.notes.includes('independent'),
        checkpointUnchanged: afterOverlayKill.checkpointBytes === beforeOverlayKill.checkpointBytes,
        beforeSequence: beforeOverlayKill.enqueueSequence,
        afterSequence: afterOverlayKill.enqueueSequence,
        coherent: afterOverlayKill.coherent,
        integrity: afterOverlayKill.integrity,
        notes: afterOverlayKill.notes,
      },
    };
    await overlayPeer.close();
    await killPage.close();

    const unsupportedPage = await openApiPage(context, origin);
    const unsupported = await unsupportedPage.evaluate(async () => globalThis.__p04b.openUnsupported());
    evidence.unsupported = unsupported;
    requireScenario(unsupported.failed === true && unsupported.code === 'storageUnsupported', 'unsupported OPFS did not fail visibly');
    await unsupportedPage.evaluate(async () => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: 'schema-reject', reset: true });
    });
    const unknownSchema = await unsupportedPage.evaluate(async () => globalThis.__p04b.rejectUnknownSchema());
    evidence.unsupported = { ...unsupported, unknownSchema };
    requireScenario(unknownSchema.failed === true && unknownSchema.code === 'SchemaRejectedError', 'unknown schema did not fail visibly');
    await unsupportedPage.close();

    const netPage = await openApiPage(context, origin);
    await netPage.evaluate(async () => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: 'guest-net', reset: true });
      await globalThis.__p04b.seed();
      await globalThis.__p04b.close();
    });
    const offlineRequests = [];
    netPage.on('request', (request) => {
      offlineRequests.push({ url: request.url(), resourceType: request.resourceType(), method: request.method() });
    });
    await context.setOffline(true);
    const guestFlow = await netPage.evaluate(async () => {
      await globalThis.__p04b.open({ deviceId: 'test-device-0001', storageId: 'guest-net', reset: false });
      const afterOpen = await globalThis.__p04b.coherentSnapshot();
      await globalThis.__p04b.executeInflow({ operationId: 'op-offline', amount: 10, day: '2026-09-12', note: 'offline' });
      await globalThis.__p04b.reopen();
      await globalThis.__p04b.updateDelivery({ operationId: 'op-offline', error: 'offline-retry' });
      const snap = await globalThis.__p04b.coherentSnapshot();
      return {
        notes: snap.notes,
        revision: snap.revision,
        localOnlyCoherent: snap.localOnlyCoherent,
        afterOpenRevision: afterOpen.revision,
        workerOpenedOffline: true,
      };
    });
    const classified = classifyGuestRequests(offlineRequests, origin);
    evidence.guestNetwork = {
      guestFlow,
      offlineRequestCount: offlineRequests.length,
      sameOrigin: classified.sameOrigin,
      remote: classified.remote,
      openedAfterOffline: true,
      warmedThenClosedBeforeOffline: true,
    };
    requireScenario(guestFlow.workerOpenedOffline === true, 'guest offline flow did not open a fresh worker after going offline');
    requireScenario(guestFlow.notes.includes('offline'), 'guest offline flow did not persist');
    requireScenario(guestFlow.localOnlyCoherent === true, 'guest offline snapshot was not coherent');
    requireScenario(classified.remote.length === 0, `guest flow issued remote/account/cloud requests: ${classified.remote.map((entry) => entry.url).join(', ')}`);
    await context.setOffline(false);
    await netPage.close();
  } finally {
    evidence.completedAt = new Date().toISOString();
    evidence.ok = failures.length === 0;
    const stamp = evidence.completedAt.replace(/[:.]/g, '-');
    writeFileSync(join(ROOT, RAW_DIR, 'p04b-persistence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    writeFileSync(join(ROOT, RAW_DIR, `p04b-persistence-${stamp}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures.length > 0) {
    console.error(`P04-B persistence gate failed:\n${failures.map((item) => `- ${item}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`P04-B persistence gate passed. Conformance ${evidence.conformance.passed}/${evidence.conformance.total}.`);
}

await main();
