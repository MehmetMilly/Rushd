/**
 * Regression coverage for IDB probe evidence binding.
 * These cases do not launch the real browser probe.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IDB_PROBE_SCHEMA,
  IDB_PROBE_SCHEMA_VERSION,
  acceptIdbProbeEvidence,
  createIdbProbeInvocation,
  EXPECTED_IDB_LEAK,
  EXPECTED_NEGATIVE_PROBE_EXIT,
  EXPECTED_OPFS_FAULT,
  idbLeakClassificationMismatch,
  opfsFaultClassificationMismatch,
} from './idb-fault-probe-contract.mjs';

function expectedLeakPayload(overrides = {}) {
  const startedAt = new Date().toISOString();
  return {
    schema: IDB_PROBE_SCHEMA,
    schemaVersion: IDB_PROBE_SCHEMA_VERSION,
    runToken: 'token-under-test',
    startedAt,
    completedAt: new Date(Date.parse(startedAt) + 1000).toISOString(),
    exitReason: 'leaked-rows',
    unexpected: [],
    leaked: true,
    trials: [0, 1, 2].map((trial) => ({
      trial,
      method: EXPECTED_IDB_LEAK.method,
      fired: EXPECTED_IDB_LEAK.fired,
      fault: EXPECTED_IDB_LEAK.fault,
      rowsBefore: EXPECTED_IDB_LEAK.rowsBefore,
      rowsAfter: EXPECTED_IDB_LEAK.rowsAfter,
      leakedFaultRows: EXPECTED_IDB_LEAK.leakedFaultRows,
      integrity: EXPECTED_IDB_LEAK.integrity,
    })),
    ...overrides,
  };
}

describe('p04a idb fault-probe evidence contract', () => {
  it('rejects a child that exits before producing fresh unique-path evidence even if a stale sibling file has the expected leak', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p04a-probe-'));
    const invocation = createIdbProbeInvocation(dir);
    writeFileSync(join(dir, 'idb-fault-probe.json'), JSON.stringify(expectedLeakPayload({
      runToken: invocation.token,
      startedAt: new Date(invocation.startedAtMs - 60_000).toISOString(),
      completedAt: new Date(invocation.startedAtMs - 59_000).toISOString(),
    }), null, 2));
    const accepted = acceptIdbProbeEvidence({
      outputPath: invocation.outputPath,
      expectedToken: invocation.token,
      startedAtMs: invocation.startedAtMs,
      probeStatus: 1,
    });
    expect(accepted.ok).toBe(false);
    expect(accepted.reason).toBe('missing-payload');
  });

  it('rejects a payload whose run token does not match this invocation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p04a-probe-'));
    mkdirSync(dir, { recursive: true });
    const invocation = createIdbProbeInvocation(dir);
    writeFileSync(invocation.outputPath, JSON.stringify(expectedLeakPayload({
      runToken: 'other-token',
      startedAt: invocation.startedAt,
      completedAt: new Date(invocation.startedAtMs + 1000).toISOString(),
    }), null, 2));
    const accepted = acceptIdbProbeEvidence({
      outputPath: invocation.outputPath,
      expectedToken: invocation.token,
      startedAtMs: invocation.startedAtMs,
      probeStatus: 1,
    });
    expect(accepted.ok).toBe(false);
    expect(accepted.reason).toBe('token-mismatch');
  });

  it('rejects malformed JSON and a stale payload that predates this invocation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p04a-probe-'));
    const invocation = createIdbProbeInvocation(dir);
    writeFileSync(invocation.outputPath, '{not-json');
    const malformed = acceptIdbProbeEvidence({
      outputPath: invocation.outputPath,
      expectedToken: invocation.token,
      startedAtMs: invocation.startedAtMs,
      probeStatus: 1,
    });
    expect(malformed.ok).toBe(false);
    expect(malformed.reason).toBe('malformed-json');

    const staleStarted = new Date(invocation.startedAtMs - 120_000).toISOString();
    writeFileSync(invocation.outputPath, JSON.stringify(expectedLeakPayload({
      runToken: invocation.token,
      startedAt: staleStarted,
      completedAt: new Date(invocation.startedAtMs - 119_000).toISOString(),
    }), null, 2));
    const stale = acceptIdbProbeEvidence({
      outputPath: invocation.outputPath,
      expectedToken: invocation.token,
      startedAtMs: invocation.startedAtMs,
      probeStatus: 1,
    });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe('stale-payload');
  });

  it('rejects a forged SQLite fault suffix that only shares the expected prefix', () => {
    const forged = '10:disk I/O error: forged-extra';
    expect(opfsFaultClassificationMismatch({
      method: EXPECTED_OPFS_FAULT.method,
      fired: EXPECTED_OPFS_FAULT.fired,
      fault: forged,
      rowsBefore: EXPECTED_OPFS_FAULT.rowsBefore,
      rowsAfter: EXPECTED_OPFS_FAULT.rowsAfter,
      leakedFaultRows: EXPECTED_OPFS_FAULT.leakedFaultRows,
      integrity: EXPECTED_OPFS_FAULT.integrity,
    })).toBe(`fault:${forged}`);
    expect(idbLeakClassificationMismatch([0, 1, 2].map((trial) => ({
      trial,
      method: EXPECTED_IDB_LEAK.method,
      fired: EXPECTED_IDB_LEAK.fired,
      fault: forged,
      rowsBefore: EXPECTED_IDB_LEAK.rowsBefore,
      rowsAfter: EXPECTED_IDB_LEAK.rowsAfter,
      leakedFaultRows: EXPECTED_IDB_LEAK.leakedFaultRows,
      integrity: EXPECTED_IDB_LEAK.integrity,
    })))).toBe(`fault:${forged}`);
    expect(opfsFaultClassificationMismatch({
      method: EXPECTED_OPFS_FAULT.method,
      fired: EXPECTED_OPFS_FAULT.fired,
      fault: EXPECTED_OPFS_FAULT.fault,
      rowsBefore: EXPECTED_OPFS_FAULT.rowsBefore,
      rowsAfter: EXPECTED_OPFS_FAULT.rowsAfter,
      leakedFaultRows: EXPECTED_OPFS_FAULT.leakedFaultRows,
      integrity: EXPECTED_OPFS_FAULT.integrity,
    })).toBe(null);
    expect(idbLeakClassificationMismatch([0, 1, 2].map((trial) => ({
      trial,
      method: EXPECTED_IDB_LEAK.method,
      fired: EXPECTED_IDB_LEAK.fired,
      fault: EXPECTED_IDB_LEAK.fault,
      rowsBefore: EXPECTED_IDB_LEAK.rowsBefore,
      rowsAfter: EXPECTED_IDB_LEAK.rowsAfter,
      leakedFaultRows: EXPECTED_IDB_LEAK.leakedFaultRows,
      integrity: EXPECTED_IDB_LEAK.integrity,
    })))).toBe(null);
  });

  it('accepts only child exit status 1 for a fresh exact leak payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p04a-probe-'));
    const invocation = createIdbProbeInvocation(dir);
    writeFileSync(invocation.outputPath, JSON.stringify(expectedLeakPayload({
      runToken: invocation.token,
      startedAt: invocation.startedAt,
      completedAt: new Date(invocation.startedAtMs + 1000).toISOString(),
    }), null, 2));
    const args = {
      outputPath: invocation.outputPath,
      expectedToken: invocation.token,
      startedAtMs: invocation.startedAtMs,
    };
    const statusTwo = acceptIdbProbeEvidence({ ...args, probeStatus: 2 });
    expect(statusTwo.ok).toBe(false);
    expect(statusTwo.reason).toBe('unexpected-status');
    const statusZero = acceptIdbProbeEvidence({ ...args, probeStatus: 0 });
    expect(statusZero.ok).toBe(false);
    expect(statusZero.reason).toBe('unexpected-zero-exit');
    const statusNull = acceptIdbProbeEvidence({ ...args, probeStatus: null });
    expect(statusNull.ok).toBe(false);
    expect(statusNull.reason).toBe('unexpected-status');
    const exact = acceptIdbProbeEvidence({ ...args, probeStatus: EXPECTED_NEGATIVE_PROBE_EXIT });
    expect(exact.ok).toBe(true);
    expect(exact.reason).toBe(null);
    expect(exact.payload.exitReason).toBe('leaked-rows');
  });
});
