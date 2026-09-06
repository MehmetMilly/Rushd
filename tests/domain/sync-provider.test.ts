/**
 * Provider substitution boundary (P03 Task D, section 6).
 *
 * No provider is approved by this task. Any substitute must prove every
 * minimum capability, and the authorized amendment path requires the same
 * contract/conformance evidence plus the founder gates.
 */

import { describe, expect, it } from 'vitest';
import {
  meetsProviderMinimum,
  PROVIDER_AMENDMENT_GATES,
  PROVIDER_SUBSTITUTION_CHECKLIST,
  type SyncProviderCapabilities,
} from '../../src/domain/sync/provider';

const FULL: SyncProviderCapabilities = {
  serverStampedOwnership: true,
  transactionalValidatedWrites: true,
  idempotentOperations: true,
  orderedReplicationCheckpoints: true,
  recoverableConflicts: true,
  exportDeletion: true,
  backupRestore: true,
  residencyEvidence: true,
};

describe('provider substitution boundary', () => {
  it('requires every minimum capability: one missing blocks substitution', () => {
    expect(meetsProviderMinimum(FULL)).toBe(true);
    for (const capability of PROVIDER_SUBSTITUTION_CHECKLIST) {
      expect(meetsProviderMinimum({ ...FULL, [capability]: false }), capability).toBe(false);
    }
  });

  it('covers ownership, writes, idempotency, checkpoints, conflicts, export/deletion, backup, and residency', () => {
    expect([...PROVIDER_SUBSTITUTION_CHECKLIST].sort()).toEqual(
      [
        'backupRestore',
        'exportDeletion',
        'idempotentOperations',
        'orderedReplicationCheckpoints',
        'recoverableConflicts',
        'residencyEvidence',
        'serverStampedOwnership',
        'transactionalValidatedWrites',
      ].sort(),
    );
    expect(PROVIDER_AMENDMENT_GATES).toContain('contractConformanceEvidenceAgainstNewAdapter');
    expect(PROVIDER_AMENDMENT_GATES).toContain('residencyDecisionWithQualifiedAdvice');
  });
});
