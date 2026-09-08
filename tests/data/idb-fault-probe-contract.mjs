/**
 * P04-A IDB fault-probe evidence contract.
 *
 * Pure validation: no browser, no Playwright. The parent experiment
 * accepts a child payload only when it is bound to this invocation by a
 * unique path, run token, schema, and timestamps. Tests cover rejection
 * of missing, mismatched, malformed, and stale payloads without touching
 * the real probe process.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const IDB_PROBE_SCHEMA = 'p04a-idb-fault-probe';
export const IDB_PROBE_SCHEMA_VERSION = 1;

export const EXPECTED_NEGATIVE_PROBE_EXIT = 1;

export const EXPECTED_IDB_LEAK = {
  trials: 3,
  fired: 1,
  rowsBefore: 50,
  rowsAfter: 80,
  leakedFaultRows: 30,
  integrity: 'ok',
  fault: '10:disk I/O error',
  method: 'jSync-IOERR_FSYNC',
};

export const EXPECTED_OPFS_FAULT = {
  trials: 3,
  fired: 1,
  rowsBefore: 50,
  rowsAfter: 50,
  leakedFaultRows: 0,
  integrity: 'ok',
  fault: '10:disk I/O error',
  method: 'jSync-IOERR_FSYNC',
};

export function idbLeakClassificationMismatch(trials) {
  if (!Array.isArray(trials) || trials.length !== EXPECTED_IDB_LEAK.trials) {
    return `trial-count:${trials ? trials.length : 'missing'}`;
  }
  for (const trial of trials) {
    if (trial.fired !== EXPECTED_IDB_LEAK.fired) return `fired:${trial.fired}`;
    if (trial.leakedFaultRows !== EXPECTED_IDB_LEAK.leakedFaultRows) return `leaked:${trial.leakedFaultRows}`;
    if (trial.rowsBefore !== EXPECTED_IDB_LEAK.rowsBefore || trial.rowsAfter !== EXPECTED_IDB_LEAK.rowsAfter) {
      return `rows:${trial.rowsBefore}->${trial.rowsAfter}`;
    }
    if (trial.integrity !== EXPECTED_IDB_LEAK.integrity) return `integrity:${trial.integrity}`;
    if (trial.fault !== EXPECTED_IDB_LEAK.fault) {
      return `fault:${trial.fault}`;
    }
    if (trial.method !== EXPECTED_IDB_LEAK.method) return `method:${trial.method}`;
  }
  return null;
}

export function opfsFaultClassificationMismatch(trial) {
  if (!trial || typeof trial !== 'object') return 'missing-trial';
  if (trial.method !== EXPECTED_OPFS_FAULT.method) return `method:${trial.method}`;
  if (trial.fired !== EXPECTED_OPFS_FAULT.fired) return `fired:${trial.fired}`;
  if (trial.fault !== EXPECTED_OPFS_FAULT.fault) {
    return `fault:${trial.fault}`;
  }
  if (trial.rowsBefore !== EXPECTED_OPFS_FAULT.rowsBefore) return `rowsBefore:${trial.rowsBefore}`;
  if (trial.rowsAfter !== EXPECTED_OPFS_FAULT.rowsAfter) return `rowsAfter:${trial.rowsAfter}`;
  if (trial.leakedFaultRows !== EXPECTED_OPFS_FAULT.leakedFaultRows) return `leaked:${trial.leakedFaultRows}`;
  if (trial.integrity !== EXPECTED_OPFS_FAULT.integrity) return `integrity:${trial.integrity}`;
  return null;
}

export function createIdbProbeInvocation(rawDirAbs) {
  const token = randomBytes(16).toString('hex');
  return {
    token,
    outputPath: join(rawDirAbs, `idb-fault-probe-run-${token}.json`),
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
  };
}

export function acceptIdbProbeEvidence({ outputPath, expectedToken, startedAtMs, probeStatus }) {
  if (probeStatus === null || probeStatus === undefined) {
    return { ok: false, reason: 'unexpected-status', payload: null };
  }
  if (!existsSync(outputPath)) {
    return { ok: false, reason: 'missing-payload', payload: null };
  }
  let text;
  try {
    text = readFileSync(outputPath, 'utf8');
  } catch {
    return { ok: false, reason: 'unreadable-payload', payload: null };
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed-json', payload: null };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'malformed-json', payload: null };
  }
  if (payload.schema !== IDB_PROBE_SCHEMA) {
    return { ok: false, reason: 'schema-mismatch', payload };
  }
  if (payload.schemaVersion !== IDB_PROBE_SCHEMA_VERSION) {
    return { ok: false, reason: 'schema-version-mismatch', payload };
  }
  if (payload.runToken !== expectedToken) {
    return { ok: false, reason: 'token-mismatch', payload };
  }
  const started = Date.parse(payload.startedAt);
  const completed = Date.parse(payload.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) {
    return { ok: false, reason: 'invalid-timestamps', payload };
  }
  if (completed < started) {
    return { ok: false, reason: 'timestamps-reversed', payload };
  }
  if (started + 50 < startedAtMs) {
    return { ok: false, reason: 'stale-payload', payload };
  }
  if (probeStatus !== EXPECTED_NEGATIVE_PROBE_EXIT) {
    return {
      ok: false,
      reason: probeStatus === 0 ? 'unexpected-zero-exit' : 'unexpected-status',
      payload,
    };
  }
  if (payload.exitReason !== 'leaked-rows') {
    return { ok: false, reason: `exit-reason:${payload.exitReason}`, payload };
  }
  const mismatch = idbLeakClassificationMismatch(payload.trials);
  if (mismatch !== null) {
    return { ok: false, reason: `classification:${mismatch}`, payload };
  }
  return { ok: true, reason: null, payload };
}
