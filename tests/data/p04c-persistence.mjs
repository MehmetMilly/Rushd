/**
 * P04-C migration and portability browser gate.
 *
 * Exercises read-only legacy extraction, staged activation, crash/retry/cancel,
 * export/import/reset, and offline network isolation against the accepted
 * durable repository. Does not rerun P04-B conformance.
 */
/* global URL: false, process: false, console: false, setTimeout: false */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = '/Users/mehmet/Desktop/Rushd';
const RAW_DIR = 'artifacts/agent-reports/p04c-raw';
const WORKER_BUNDLE = `${RAW_DIR}/sqlite-worker.bundle.mjs`;
const PAGE_API_BUNDLE = `${RAW_DIR}/p04c-page-api.bundle.mjs`;
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };

const failures = [];
function requireScenario(condition, label) {
  if (!condition) failures.push(label);
}

function hasHandlerClockEvidence(journal) {
  return journal.operations.every((operation) =>
    operation.handlerClockVersion === 1 &&
    operation.receipt?.handlerClockVersion === 1 &&
    Array.isArray(operation.handlerClockInstants) &&
    JSON.stringify(operation.handlerClockInstants) === JSON.stringify(operation.receipt?.handlerClockInstants),
  );
}

function loadFixture(relative) {
  return JSON.parse(readFileSync(join(ROOT, 'tests/fixtures', relative), 'utf8'));
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
    if (parsed.origin === origin) sameOrigin.push(entry);
    else remote.push(entry);
  }
  return { sameOrigin, remote };
}

function trackPromise(promise) {
  const state = { done: false, value: null, error: null };
  const tracked = promise.then(
    (value) => {
      state.done = true;
      state.value = value;
      return value;
    },
    (error) => {
      state.done = true;
      state.error = error;
      throw error;
    },
  );
  return { promise: tracked, state };
}

async function listRaceTokens(page, raceId) {
  if (page.isClosed()) return [];
  return page.evaluate(async (id) => globalThis.__p04c.listCasRaceArrivals(id), raceId);
}

async function releaseRace(page, raceId) {
  if (page.isClosed()) return;
  await page.evaluate(async (id) => globalThis.__p04c.releaseCasRace(id), raceId);
}

async function raceAtCasStaggered(page, pageB, raceId, startLeft, startRight, timeoutMs = 120000) {
  const left = trackPromise(startLeft());
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      if (left.state.done) {
        const right = trackPromise(startRight());
        await releaseRace(page, raceId).catch(() => undefined);
        const results = await Promise.all([left.promise, right.promise]);
        return { results, early: true, tokens: await listRaceTokens(page, raceId) };
      }
      const tokens = await listRaceTokens(page, raceId);
      if (tokens.some((row) => row.participantId === 'A' && row.phase === 'pre-cas')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const parked = await listRaceTokens(page, raceId);
    if (!parked.some((row) => row.participantId === 'A' && row.phase === 'pre-cas')) {
      await releaseRace(page, raceId).catch(() => undefined);
      throw new Error(`CAS race ${raceId} missing parked participant A; settled=${left.state.done} tokens=${JSON.stringify(parked)}`);
    }
    const right = trackPromise(startRight());
    while (Date.now() - started < timeoutMs) {
      if (left.state.done || right.state.done) {
        await releaseRace(page, raceId).catch(() => undefined);
        const results = await Promise.all([left.promise, right.promise]);
        return { results, early: true, tokens: await listRaceTokens(page, raceId) };
      }
      const tokens = await listRaceTokens(page, raceId);
      const arrived = new Set(tokens.map((row) => row.participantId));
      if (arrived.has('A') && arrived.has('B')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const tokens = await listRaceTokens(page, raceId);
    const arrived = new Set(tokens.map((row) => row.participantId));
    if (!(arrived.has('A') && arrived.has('B'))) {
      await releaseRace(page, raceId).catch(() => undefined);
      throw new Error(
        `CAS race ${raceId} missing participant before release; ASettled=${left.state.done} BSettled=${right.state.done} tokens=${JSON.stringify(tokens)}`,
      );
    }
    await releaseRace(page, raceId);
    const results = await Promise.all([left.promise, right.promise]);
    return { results, early: false, tokens };
  } catch (error) {
    await releaseRace(page, raceId).catch(() => undefined);
    throw error;
  }
}

async function raceAtCas(page, pageB, raceId, startLeft, startRight, timeoutMs = 120000) {
  const left = trackPromise(startLeft());
  const right = trackPromise(startRight());
  const started = Date.now();
  let tokens = [];
  try {
    while (Date.now() - started < timeoutMs) {
      if (left.state.done || right.state.done) {
        await releaseRace(page, raceId).catch(() => undefined);
        const results = await Promise.all([left.promise, right.promise]);
        tokens = await listRaceTokens(page, raceId);
        return { results, early: true, tokens };
      }
      tokens = await listRaceTokens(page, raceId);
      const arrived = new Set(tokens.map((row) => row.participantId));
      if (arrived.has('A') && arrived.has('B')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    tokens = await listRaceTokens(page, raceId);
    const arrived = new Set(tokens.map((row) => row.participantId));
    if (!(arrived.has('A') && arrived.has('B'))) {
      await releaseRace(page, raceId).catch(() => undefined);
      throw new Error(
        `CAS race ${raceId} missing participant before release; ASettled=${left.state.done} BSettled=${right.state.done} tokens=${JSON.stringify(tokens)}`,
      );
    }
    await releaseRace(page, raceId);
    const results = await Promise.all([left.promise, right.promise]);
    return { results, early: false, tokens };
  } catch (error) {
    await releaseRace(page, raceId).catch(() => undefined);
    throw error;
  }
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/' || url.pathname === '/page') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><body>p04c</body></html>');
        return;
      }
      if (url.pathname.startsWith('/harness/')) {
        const name = url.pathname.slice('/harness/'.length);
        const file =
          name === 'v2-worker.js'
            ? join(ROOT, WORKER_BUNDLE)
            : name === 'p04c-page-api.bundle.mjs'
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
  execFileSync(esbuild, ['src/data/v2/sqlite-worker.ts', '--bundle', '--format=esm', '--platform=browser', `--outfile=${WORKER_BUNDLE}`], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  execFileSync(
    esbuild,
    ['tests/data/p04c-page-api.ts', '--bundle', '--format=esm', '--platform=browser', `--outfile=${PAGE_API_BUNDLE}`],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

async function openApiPage(context, origin) {
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  await page.goto(`${origin}/page`);
  await page.addScriptTag({ type: 'module', url: `${origin}/harness/p04c-page-api.bundle.mjs` });
  await page.waitForFunction(() => globalThis.__p04c !== undefined);
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
  const network = [];
  context.on('request', (request) => {
    network.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
    });
  });

  const empty = loadFixture('v1/empty.json');
  const populated = loadFixture('v1/populated.json');
  const mixed = loadFixture('v1/p04c/mixed-unpaid.json');
  const adversarial = loadFixture('v1/p04c/adversarial-money.json');

  const evidence = {
    schema: 'p04c-persistence',
    startedAt: new Date().toISOString(),
    origin,
    browser: 'Chromium',
    backend: 'OPFSCoopSyncVFS',
    sqlitePackage: '@journeyapps/wa-sqlite@2.0.4',
    sqliteEngine: '3.53.0',
    localSchemaVersion: 1,
    immutableSource: null,
    emptyMigration: null,
    mixedMigration: null,
    populatedMigration: null,
    failBeforeStaging: null,
    failDuringStaging: null,
    retryAfterStaging: null,
    cancelBeforeCommit: null,
    failBeforeActivation: null,
    failDuringActivation: null,
    replayActive: null,
    unsupported: null,
    exportImportReset: null,
    importCancel: null,
    resetScopeMismatch: null,
    adversarialPlan: null,
    sourceOpenError: null,
    resetCancelAfterStaging: null,
    deliveryRoundTrip: null,
    malformedImport: null,
    failClosedProbes: null,
    sourceDiscoveryError: null,
    replayDifferentInput: null,
    concurrentActivation: null,
    concurrentImportRaces: null,
    earlyStagingRace: null,
    longIdPlan: null,
    settlementLinks: null,
    guestNetwork: null,
    failures,
  };

  const page = await openApiPage(context, origin);
  try {
    evidence.immutableSource = await page.evaluate(async (fixture) => globalThis.__p04c.seedAndExtract(fixture), populated);
    requireScenario(evidence.immutableSource.ok === true, 'extraction failed');
    requireScenario(evidence.immutableSource.unchanged === true, 'legacy source mutated during extraction');
    requireScenario(
      typeof evidence.immutableSource.fingerprint === 'string' &&
        /^[0-9a-f]{16}$/.test(evidence.immutableSource.fingerprint) &&
        !String(evidence.immutableSource.fingerprint).includes('{'),
      'source identity is not a digest',
    );

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    evidence.emptyMigration = await page.evaluate(async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-empty', fixture }), empty);
    requireScenario(evidence.emptyMigration.ok === true, 'empty migration failed');
    requireScenario(evidence.emptyMigration.activationCommitted === true, 'empty migration did not commit activation');
    requireScenario(evidence.emptyMigration.sourceUnchanged === true, 'empty migration mutated MicroSaveOS_DB');

    const emptySnap = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    requireScenario(emptySnap.currency === 'SAR', 'empty active book is not SAR');
    requireScenario(emptySnap.journal.operations.length === emptySnap.journal.outbox.length, 'empty journal/outbox asymmetry');
    requireScenario(hasHandlerClockEvidence(emptySnap.journal), 'migration did not durably reopen handler-clock evidence');
    const smallDocument = await page.evaluate(async () => globalThis.__p04c.exportNow());
    const smallSnapshot = JSON.parse(smallDocument.snapshotCanonical);
    requireScenario(hasHandlerClockEvidence(smallSnapshot), 'export omitted handler-clock evidence');

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    evidence.mixedMigration = await page.evaluate(async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-mixed', fixture }), mixed);
    requireScenario(evidence.mixedMigration.ok === true, 'mixed migration failed');
    const mixedSnap = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    requireScenario(mixedSnap.obligations >= 1, 'unpaid essential was not reserved');
    requireScenario(mixedSnap.journal.enqueueSequence === mixedSnap.journal.operations.length, 'mixed enqueue/journal mismatch');
    requireScenario(mixedSnap.journal.operations.length === mixedSnap.journal.outbox.length, 'mixed journal/outbox mismatch');

    evidence.adversarialPlan = await page.evaluate(async (fixture) => globalThis.__p04c.planOnly(fixture), adversarial);
    requireScenario(evidence.adversarialPlan.ok === true, 'adversarial plan failed');
    requireScenario(evidence.adversarialPlan.reviewReasons.includes('excess-precision'), 'excess precision not quarantined');
    requireScenario(evidence.adversarialPlan.reviewReasons.includes('duplicate-id'), 'duplicate id not quarantined');

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    evidence.failBeforeStaging = await page.evaluate(
      async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-fail-before', fixture, failAt: 'before-staging', memoryControl: true }),
      empty,
    );
    requireScenario(evidence.failBeforeStaging.ok === false, 'before-staging did not fail');
    requireScenario(evidence.failBeforeStaging.activationCommitted === false, 'before-staging committed activation');

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    evidence.failDuringStaging = await page.evaluate(
      async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-fail-stage', fixture, failAt: 'during-staging-write' }),
      empty,
    );
    requireScenario(evidence.failDuringStaging.ok === false, 'staging-write did not fail');
    requireScenario(evidence.failDuringStaging.activationCommitted === false, 'staging-write committed activation');
    evidence.retryAfterStaging = await page.evaluate(async (fixture) => globalThis.__p04c.retry({ migrationId: 'mig-fail-stage', fixture }), empty);
    requireScenario(evidence.retryAfterStaging.ok === true, 'retry after staging failure failed');
    requireScenario(evidence.retryAfterStaging.activationCommitted === true, 'retry did not activate');
    const retrySnap = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    requireScenario(retrySnap.journal.operations.length === retrySnap.journal.outbox.length, 'retry produced journal/outbox duplicates');

    evidence.cancelBeforeCommit = await page.evaluate(async (fixture) => globalThis.__p04c.migrateWithAbort({ migrationId: 'mig-cancel', fixture }), empty);
    requireScenario(evidence.cancelBeforeCommit.ok === false, 'cancel did not fail');
    requireScenario(evidence.cancelBeforeCommit.cancelled === true, 'cancel was not marked cancelled');
    requireScenario(evidence.cancelBeforeCommit.activationCommitted === false, 'cancel committed activation');

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    evidence.failBeforeActivation = await page.evaluate(
      async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-pre-act', fixture, failAt: 'immediately-before-activation', memoryControl: true }),
      empty,
    );
    requireScenario(evidence.failBeforeActivation.ok === false, 'pre-activation did not fail');
    requireScenario(evidence.failBeforeActivation.activationCommitted === false, 'pre-activation committed');

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    evidence.failDuringActivation = await page.evaluate(
      async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-act', fixture, failAt: 'during-activation', memoryControl: true }),
      empty,
    );
    requireScenario(evidence.failDuringActivation.ok === false, 'during-activation did not fail');
    requireScenario(evidence.failDuringActivation.activationCommitted === false, 'during-activation committed');

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    const first = await page.evaluate(async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-replay', fixture }), empty);
    evidence.replayActive = await page.evaluate(async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-replay', fixture }), empty);
    requireScenario(first.ok === true && evidence.replayActive.ok === true, 'replay migration failed');
    requireScenario(evidence.replayActive.replayed === true, 'replay was not idempotent');

    evidence.unsupported = await page.evaluate(async (fixture) => {
      await globalThis.__p04c.resetControl();
      return globalThis.__p04c.migrateUnsupported({ migrationId: 'mig-unsup', fixture });
    }, empty);
    requireScenario(evidence.unsupported.ok === false, 'unsupported storage did not fail visibly');
    requireScenario(evidence.unsupported.activationCommitted === false, 'unsupported storage committed activation');

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    evidence.populatedMigration = await page.evaluate(async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-pop', fixture }), populated);
    requireScenario(evidence.populatedMigration.ok === true, 'populated migration failed');
    const exported = await page.evaluate(async () => globalThis.__p04c.exportNow());
    const beforeImport = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    const preview = await page.evaluate(async (document) => globalThis.__p04c.previewImport(document), exported);
    requireScenario(preview.bookCount >= 1, 'import preview missing books');
    const cancelImport = await page.evaluate(
      async (document) => globalThis.__p04c.importNow({ importId: 'imp-cancel', document, confirmation: '' }),
      exported,
    );
    evidence.importCancel = cancelImport;
    requireScenario(cancelImport.ok === false, 'empty confirmation imported');
    const afterCancel = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    requireScenario(afterCancel.snapshotBytes === beforeImport.snapshotBytes, 'cancel import changed active bytes');

    const imported = await page.evaluate(
      async ({ document, confirmation }) => globalThis.__p04c.importNow({ importId: 'imp-1', document, confirmation }),
      { document: exported, confirmation: 'REPLACE-ACTIVE-DATABASE' },
    );
    requireScenario(imported.ok === true, 'import replacement failed');
    const reopened = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    requireScenario(reopened.snapshotBytes === beforeImport.snapshotBytes, 'round-trip snapshot identity drifted');
    requireScenario(reopened.journal.operations.length === reopened.journal.outbox.length, 'imported journal/outbox asymmetry');
    requireScenario(hasHandlerClockEvidence(reopened.journal), 'import/reopen lost handler-clock evidence');

    const mismatch = await page.evaluate(async () =>
      globalThis.__p04c.resetNow({ resetId: 'rst-mismatch', confirmation: 'RESET-GUEST-SCOPE', scopeId: 'scope:account:other' }),
    );
    evidence.resetScopeMismatch = mismatch;
    requireScenario(mismatch.ok === false, 'reset scope mismatch was allowed');
    const afterMismatch = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    requireScenario(afterMismatch.snapshotBytes === reopened.snapshotBytes, 'scope-mismatch reset mutated active state');

    const reset = await page.evaluate(async () => globalThis.__p04c.resetNow({ resetId: 'rst-1', confirmation: 'RESET-GUEST-SCOPE' }));
    requireScenario(reset.ok === true, 'scoped reset failed');
    const resetSnap = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    requireScenario(resetSnap.revision === 0, 'reset left finance state');
    evidence.exportImportReset = {
      exportedBooks: preview.bookCount,
      importOk: imported.ok === true,
      resetOk: reset.ok === true,
      roundTrip: reopened.snapshotBytes === beforeImport.snapshotBytes,
      handlerClockEvidence: hasHandlerClockEvidence(reopened.journal),
    };

    evidence.sourceOpenError = await page.evaluate(async () => globalThis.__p04c.extractOpenError());
    requireScenario(evidence.sourceOpenError.ok === false, 'source-open error was treated as an empty source');
    requireScenario(evidence.sourceOpenError.reason === 'extraction-failure' || evidence.sourceOpenError.reason === 'quota-or-private', 'source-open error reason was not fail-closed');

    evidence.sourceDiscoveryError = await page.evaluate(async () => globalThis.__p04c.extractDiscoveryError());
    requireScenario(evidence.sourceDiscoveryError.ok === false, 'database discovery error was not fail-closed');
    requireScenario(evidence.sourceDiscoveryError.reason !== 'unstructured-rejection', 'database discovery leaked an unstructured rejection');
    requireScenario(
      evidence.sourceDiscoveryError.reason === 'extraction-failure' || evidence.sourceDiscoveryError.reason === 'quota-or-private',
      'database discovery error was not an explicit extraction failure',
    );

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    await page.evaluate(async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-reset-base', fixture }), empty);
    const beforeReset = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    evidence.resetCancelAfterStaging = await page.evaluate(async () =>
      globalThis.__p04c.resetNow({ resetId: 'rst-cancel', confirmation: 'RESET-GUEST-SCOPE', failAt: 'after-staging' }),
    );
    requireScenario(evidence.resetCancelAfterStaging.ok === false, 'reset cancel after staging did not fail');
    requireScenario(evidence.resetCancelAfterStaging.activationCommitted === false, 'reset cancel after staging committed');
    const afterResetCancel = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    requireScenario(afterResetCancel.snapshotBytes === beforeReset.snapshotBytes, 'reset cancel after staging mutated active bytes');

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    await page.evaluate(async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-history', fixture }), populated);
    evidence.deliveryRoundTrip = await page.evaluate(async () => globalThis.__p04c.prepareExportWithHistory());
    requireScenario(evidence.deliveryRoundTrip.deliveryVersions.some((version) => version >= 2), 'delivery history was not version 2+');
    requireScenario(evidence.deliveryRoundTrip.bookCount >= 2, 'second book was not exported');
    const historyBefore = evidence.deliveryRoundTrip.snapshotBytes;
    const malformed = JSON.parse(JSON.stringify(evidence.deliveryRoundTrip.document));
    const parsedSnap = JSON.parse(malformed.snapshotCanonical);
    parsedSnap.operations = [{ operationId: 'op-1', enqueueSequence: 1 }];
    parsedSnap.outbox = [{ operationId: 'op-1', enqueueSequence: 1 }];
    malformed.snapshotCanonical = JSON.stringify(parsedSnap);
    malformed.integrity = 'deadbeefdeadbeef';
    evidence.malformedImport = await page.evaluate(
      async ({ document, confirmation }) => globalThis.__p04c.importNow({ importId: 'imp-malformed', document, confirmation }),
      { document: malformed, confirmation: 'REPLACE-ACTIVE-DATABASE' },
    );
    requireScenario(evidence.malformedImport.ok === false, 'malformed portable records were imported');
    requireScenario(evidence.malformedImport.activationCommitted === false, 'malformed import committed activation');

    const beforeProbes = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    evidence.failClosedProbes = await page.evaluate(
      async (document) => globalThis.__p04c.probeFailClosed(document),
      smallDocument,
    );
    requireScenario(evidence.failClosedProbes.nestedEmptyEntry.ok === false, 'entries: [{}] was imported');
    requireScenario(evidence.failClosedProbes.emptyCanonicalCommand.ok === false, 'empty canonical command was imported');
    requireScenario(evidence.failClosedProbes.forgedProvenance.ok === false, 'forged empty-record provenance was imported');
    requireScenario(evidence.failClosedProbes.sequenceGap.ok === false, 'enqueue gap 1,3 was imported');
    requireScenario(evidence.failClosedProbes.duplicateOutboxId.ok === false, 'duplicate outboxId was imported');
    requireScenario(evidence.failClosedProbes.rawSourceFingerprint.ok === false, 'raw source fingerprint was imported');
    requireScenario(evidence.failClosedProbes.discovery.ok === false, 'discovery exception was not fail-closed');
    requireScenario(evidence.failClosedProbes.discovery.reason !== 'unstructured-rejection', 'discovery exception leaked');
    requireScenario(
      evidence.failClosedProbes.activeStorageAfter === evidence.failClosedProbes.activeStorageBefore,
      'fail-closed probes mutated the activation pointer',
    );
    requireScenario(
      evidence.failClosedProbes.nestedEmptyEntry.activationCommitted === false &&
        evidence.failClosedProbes.emptyCanonicalCommand.activationCommitted === false &&
        evidence.failClosedProbes.forgedProvenance.activationCommitted === false &&
        evidence.failClosedProbes.sequenceGap.activationCommitted === false &&
        evidence.failClosedProbes.duplicateOutboxId.activationCommitted === false &&
        evidence.failClosedProbes.rawSourceFingerprint.activationCommitted === false,
      'fail-closed probe reported activation',
    );
    const afterProbes = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    requireScenario(afterProbes.snapshotBytes === beforeProbes.snapshotBytes, 'fail-closed probes mutated active bytes');
    requireScenario(afterProbes.storageId === beforeProbes.storageId, 'fail-closed probes changed active storage');

    const historyImported = await page.evaluate(
      async ({ document, confirmation }) => globalThis.__p04c.importNow({ importId: 'imp-history', document, confirmation }),
      { document: evidence.deliveryRoundTrip.document, confirmation: 'REPLACE-ACTIVE-DATABASE' },
    );
    requireScenario(historyImported.ok === true, 'history import failed');
    const historyReopened = await page.evaluate(async () => globalThis.__p04c.activeSnapshot());
    requireScenario(historyReopened.snapshotBytes === historyBefore, 'delivery/checkpoint/book round-trip drifted');
    requireScenario(hasHandlerClockEvidence(historyReopened.journal), 'history checkpoint import/reopen lost handler-clock evidence');
    const replaySame = await page.evaluate(
      async ({ document, confirmation }) => globalThis.__p04c.importNow({ importId: 'imp-history', document, confirmation }),
      { document: evidence.deliveryRoundTrip.document, confirmation: 'REPLACE-ACTIVE-DATABASE' },
    );
    requireScenario(replaySame.ok === true && replaySame.replayed === true, 'same-document import replay was not idempotent');
    evidence.replayDifferentInput = await page.evaluate(
      async ({ document, confirmation }) => globalThis.__p04c.importNow({ importId: 'imp-history', document, confirmation }),
      { document: exported, confirmation: 'REPLACE-ACTIVE-DATABASE' },
    );
    requireScenario(evidence.replayDifferentInput.ok === false, 'same import id with different input succeeded');
    requireScenario(evidence.replayDifferentInput.reason === 'replay-conflict', 'different-input replay did not fail as replay-conflict');

    const longLeft = `e${'x'.repeat(94)}`;
    const longRight = `e${'x'.repeat(93)}y`;
    evidence.longIdPlan = await page.evaluate(
      async ({ left, right }) =>
        globalThis.__p04c.planOnly({
          schema: 'rushd.v1-fixture.v1',
          indexed_db: {
            name: 'MicroSaveOS_DB',
            version: 1,
            stores: {
              settings: [{ key: 'baseAllowance', value: 40 }],
              templates: [],
              expenses: [
                { id: left, name: 'FAKE long a', expectedCost: 2, actualPaid: 2, isPaid: true, classification: 'essential', date: '2026-08-02' },
                { id: right, name: 'FAKE long b', expectedCost: 3, actualPaid: 3, isPaid: true, classification: 'essential', date: '2026-08-03' },
              ],
            },
          },
        }),
      { left: longLeft, right: longRight },
    );
    requireScenario(evidence.longIdPlan.ok === true, 'long-id plan failed');
    const expenseKinds = (evidence.longIdPlan.commandKinds ?? []).filter((kind) => kind === 'recordExpense');
    requireScenario(expenseKinds.length === 2, 'long-id expenses were dropped or collided before planning');

    evidence.settlementLinks = await page.evaluate(async () =>
      globalThis.__p04c.planOnly({
        schema: 'rushd.v1-fixture.v1',
        indexed_db: {
          name: 'MicroSaveOS_DB',
          version: 1,
          stores: {
            settings: [
              { key: 'baseAllowance', value: 80 },
              {
                key: 'vault',
                value: { balance: 30, transactions: [{ id: 'tx-shared', amount: 30, date: '2026-02-01', sourceMonthKey: '2026-01' }], goals: [] },
              },
              {
                key: 'monthEndSettlements',
                value: [
                  { previousMonthKey: '2026-01', decision: 'vault', targetMonthKey: '2026-02', surplus: 30, vaultTransactionId: 'tx-shared' },
                  { previousMonthKey: '2026-02', decision: 'vault', targetMonthKey: '2026-03', surplus: 30, vaultTransactionId: 'tx-shared' },
                ],
              },
            ],
            templates: [],
            expenses: [
              { id: 'exp-jan', name: 'FAKE', expectedCost: 1, actualPaid: 1, isPaid: true, classification: 'essential', date: '2026-01-04' },
              { id: 'exp-feb', name: 'FAKE', expectedCost: 1, actualPaid: 1, isPaid: true, classification: 'essential', date: '2026-02-04' },
            ],
          },
        },
      }),
    );
    requireScenario(evidence.settlementLinks.ok === true, 'settlement-link plan failed');
    requireScenario((evidence.settlementLinks.reviewReasons ?? []).includes('duplicate-settlement'), 'reused vault link was not quarantined');
    requireScenario((evidence.settlementLinks.vaultFundingIds ?? []).length <= 1, 'reused vault link produced duplicate funding identities');

    const pageB = await openApiPage(context, origin);
    await page.evaluate(async () => globalThis.__p04c.resetControl());
    const beforeMigrate = await page.evaluate(async () => globalThis.__p04c.pointerState());
    const concurrentMigrate = await raceAtCasStaggered(
      page,
      pageB,
      'race-mig-1',
      () => page.evaluate(async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-cas-a', fixture, raceId: 'race-mig-1', participantId: 'A' }), empty),
      () => pageB.evaluate(async (fixture) => globalThis.__p04c.migrate({ migrationId: 'mig-cas-b', fixture, raceId: 'race-mig-1', participantId: 'B' }), empty),
    );
    requireScenario(concurrentMigrate.early === false, 'migration race released before both CAS arrivals');
    requireScenario(
      concurrentMigrate.tokens.some((row) => row.participantId === 'A' && row.phase === 'pre-cas') &&
        concurrentMigrate.tokens.some((row) => row.participantId === 'B' && row.phase === 'pre-cas'),
      'migration race missing unique pre-cas tokens',
    );
    const afterMigrate = await page.evaluate(async () => globalThis.__p04c.pointerState());
    requireScenario(afterMigrate.generation === beforeMigrate.generation + 1, 'migration CAS did not increment generation once');
    const migrateWinner = concurrentMigrate.results.find((item) => item.ok === true);
    requireScenario(migrateWinner !== undefined && afterMigrate.activeStorageId === migrateWinner.activeStorageId, 'migration pointer does not name the winner');

    const concurrentImport = await raceAtCasStaggered(
      page,
      pageB,
      'race-imp-1',
      () => page.evaluate(
        async ({ document, confirmation }) => globalThis.__p04c.importNow({ importId: 'imp-cas-a', document, confirmation, raceId: 'race-imp-1', participantId: 'A' }),
        { document: exported, confirmation: 'REPLACE-ACTIVE-DATABASE' },
      ),
      () => pageB.evaluate(
        async ({ document, confirmation }) => globalThis.__p04c.importNow({ importId: 'imp-cas-b', document, confirmation, raceId: 'race-imp-1', participantId: 'B' }),
        { document: exported, confirmation: 'REPLACE-ACTIVE-DATABASE' },
      ),
    );
    requireScenario(concurrentImport.early === false, 'import race released before both CAS arrivals');
    const afterImport = await page.evaluate(async () => globalThis.__p04c.pointerState());
    const importWinner = concurrentImport.results.find((item) => item.ok === true);
    requireScenario(importWinner !== undefined && afterImport.activeStorageId === importWinner.activeStorageId, 'import pointer does not name the winner');

    const concurrentReset = await raceAtCasStaggered(
      page,
      pageB,
      'race-rst-1',
      () => page.evaluate(async () => globalThis.__p04c.resetNow({ resetId: 'rst-cas-a', confirmation: 'RESET-GUEST-SCOPE', raceId: 'race-rst-1', participantId: 'A' })),
      () => pageB.evaluate(async () => globalThis.__p04c.resetNow({ resetId: 'rst-cas-b', confirmation: 'RESET-GUEST-SCOPE', raceId: 'race-rst-1', participantId: 'B' })),
    );
    requireScenario(concurrentReset.early === false, 'reset race released before both CAS arrivals');

    const summarize = (results) => ({
      winners: results.filter((item) => item.ok === true).length,
      conflicts: results.filter((item) => item.ok === false && item.reason === 'activation-conflict').length,
      committedSuccesses: results.filter((item) => item.ok === true && item.activationCommitted === true).length,
      reasons: results.map((item) => item.reason ?? 'ok'),
    });
    evidence.concurrentActivation = {
      migration: { ...summarize(concurrentMigrate.results), tokens: concurrentMigrate.tokens },
      import: { ...summarize(concurrentImport.results), tokens: concurrentImport.tokens },
      reset: { ...summarize(concurrentReset.results), tokens: concurrentReset.tokens },
    };
    for (const [name, summary] of Object.entries(evidence.concurrentActivation)) {
      requireScenario(summary.winners === 1, `concurrent ${name} winners ${summary.winners}`);
      requireScenario(summary.conflicts === 1, `concurrent ${name} conflicts ${summary.conflicts}`);
      requireScenario(summary.committedSuccesses === 1, `concurrent ${name} committed successes ${summary.committedSuccesses}`);
    }

    const importRacePageA = await openApiPage(context, origin);
    const importRacePageB = await openApiPage(context, origin);
    const importRaces = [];
    for (let index = 0; index < 10; index += 1) {
      const raceId = `race-imp-repeat-${index}`;
      const raced = await raceAtCasStaggered(
        importRacePageA,
        importRacePageB,
        raceId,
        () => importRacePageA.evaluate(
          async ({ document, confirmation, raceId: id }) => globalThis.__p04c.importNow({ importId: `imp-repeat-a-${id}`, document, confirmation, raceId: id, participantId: 'A' }),
          { document: smallDocument, confirmation: 'REPLACE-ACTIVE-DATABASE', raceId },
        ),
        () => importRacePageB.evaluate(
          async ({ document, confirmation, raceId: id }) => globalThis.__p04c.importNow({ importId: `imp-repeat-b-${id}`, document, confirmation, raceId: id, participantId: 'B' }),
          { document: smallDocument, confirmation: 'REPLACE-ACTIVE-DATABASE', raceId },
        ),
      );
      const summary = summarize(raced.results);
      importRaces.push({
        raceId,
        early: raced.early,
        tokens: raced.tokens,
        details: raced.results.map((item) => item.detail ?? null),
        ...summary,
      });
      requireScenario(raced.early === false, `import repeat ${raceId} released before both CAS arrivals`);
      requireScenario(summary.winners === 1 && summary.conflicts === 1, `import repeat ${raceId} was not one winner and one conflict`);
      requireScenario(
        raced.tokens.some((row) => row.participantId === 'A') && raced.tokens.some((row) => row.participantId === 'B'),
        `import repeat ${raceId} reused or dropped participant tokens`,
      );
      await importRacePageA.evaluate(async () => globalThis.__p04c.cleanupInactiveOpfs());
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    evidence.concurrentImportRaces = importRaces;
    await importRacePageA.close();
    await importRacePageB.close();

    await page.evaluate(async () => globalThis.__p04c.resetControl());
    const earlyRace = await raceAtCas(
      page,
      pageB,
      'race-early-stage',
      () => page.evaluate(
        async (fixture) => globalThis.__p04c.migrate({
          migrationId: 'mig-early-a',
          fixture,
          failAt: 'before-staging',
          raceId: 'race-early-stage',
          participantId: 'A',
        }),
        empty,
      ),
      () => pageB.evaluate(
        async (fixture) => globalThis.__p04c.migrate({
          migrationId: 'mig-early-b',
          fixture,
          raceId: 'race-early-stage',
          participantId: 'B',
        }),
        empty,
      ),
    );
    evidence.earlyStagingRace = {
      early: earlyRace.early,
      tokens: earlyRace.tokens,
      reasons: earlyRace.results.map((item) => item.reason ?? 'ok'),
    };
    requireScenario(earlyRace.early === true, 'early staging failure waited for the CAS barrier');
    requireScenario(earlyRace.results.some((item) => item.ok === false && item.activationCommitted === false), 'early staging participant did not fail closed');
    await pageB.close();

    const classified = classifyGuestRequests(network, origin);
    evidence.guestNetwork = {
      total: network.length,
      remote: classified.remote,
      sameOriginKinds: [...new Set(classified.sameOrigin.map((entry) => entry.resourceType))],
    };
    requireScenario(classified.remote.length === 0, `guest issued remote requests: ${classified.remote.map((entry) => entry.url).join(', ')}`);
    requireScenario(
      !network.some((entry) => entry.resourceType === 'websocket' || entry.resourceType === 'ping' || entry.method === 'CONNECT'),
      'guest issued websocket/beacon/connect',
    );
  } finally {
    await page.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  evidence.finishedAt = new Date().toISOString();
  evidence.passed = failures.length === 0;
  const stamp = evidence.finishedAt.replace(/[:.]/g, '-');
  const out = join(ROOT, RAW_DIR, `p04c-persistence-${stamp}.json`);
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  writeFileSync(join(ROOT, RAW_DIR, 'p04c-persistence.json'), JSON.stringify(evidence, null, 2));
  if (failures.length > 0) {
    console.error(`P04-C persistence failures (${failures.length}):`);
    for (const label of failures) console.error(` - ${label}`);
    process.exit(1);
  }
  console.log(`P04-C persistence passed; evidence ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
