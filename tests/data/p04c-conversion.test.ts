/**
 * P04-C exact SAR conversion and quarantine (Node). Durable staging is
 * covered by the Chromium persistence gate.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertUntaggedSarMajor, requireNonNegative, requireStrictlyPositive } from '../../src/data/migration/money-conversion';
import { MIGRATION_REASON } from '../../src/data/migration/reasons';
import { extractLegacyIndexedDb, snapshotFromP00Fixture, snapshotFromStores, sourceFingerprintOf } from '../../src/data/migration/extract';
import { planLegacyMigration } from '../../src/data/migration/mapping';

const src = {
  database: 'MicroSaveOS_DB' as const,
  databaseVersion: 1 as const,
  store: 'expenses' as const,
  recordKey: 'fake-1',
  field: 'actualPaid',
};

function fixture(relative: string) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${relative}`, import.meta.url), 'utf8')) as unknown;
}

describe('p04c SAR conversion', () => {
  it('converts integer and two-decimal major units to halalas exactly', () => {
    const whole = convertUntaggedSarMajor(1000, src);
    const split = convertUntaggedSarMajor(112.5, src);
    const arabic = convertUntaggedSarMajor('٢٥.٥٠', src);
    expect(whole.ok && whole.money.minorUnits).toBe(100_000);
    expect(split.ok && split.money.minorUnits).toBe(11_250);
    expect(arabic.ok && arabic.money.minorUnits).toBe(2_550);
    if (whole.ok) expect(whole.money.currency).toBe('SAR');
  });

  it('quarantines excess precision, non-finite, corrupt, sign, and ambiguous currency', () => {
    const excess = convertUntaggedSarMajor(1.234, src);
    const nan = convertUntaggedSarMajor(Number.NaN, src);
    const object = convertUntaggedSarMajor({ amount: 1 }, src);
    const labeled = convertUntaggedSarMajor('12 SAR', src);
    const dollar = convertUntaggedSarMajor('$12', src);
    expect(excess.ok).toBe(false);
    expect(nan.ok).toBe(false);
    expect(object.ok).toBe(false);
    expect(labeled.ok).toBe(false);
    expect(dollar.ok).toBe(false);
    if (!excess.ok) expect(excess.reason).toBe(MIGRATION_REASON.excessPrecision);
    if (!nan.ok) expect(nan.reason).toBe(MIGRATION_REASON.nonFinite);
    if (!object.ok) expect(object.reason).toBe(MIGRATION_REASON.corruptType);
    if (!labeled.ok) expect(labeled.reason).toBe(MIGRATION_REASON.ambiguousCurrency);
    if (!dollar.ok) expect(dollar.reason).toBe(MIGRATION_REASON.ambiguousCurrency);
    const negative = requireNonNegative(convertUntaggedSarMajor(-9, src));
    expect(!negative.ok && negative.reason).toBe(MIGRATION_REASON.invalidSign);
    const zero = requireStrictlyPositive(convertUntaggedSarMajor(0, src));
    expect(!zero.ok && zero.reason).toBe(MIGRATION_REASON.invalidRange);
  });

  it('does not round binary float residue away', () => {
    const residue = convertUntaggedSarMajor(0.30000000000000004, { ...src, field: 'baseAllowance', store: 'settings', recordKey: 'baseAllowance' });
    expect(residue.ok).toBe(false);
    if (!residue.ok) expect(residue.reason).toBe(MIGRATION_REASON.excessPrecision);
    expect(residue.originalValue).toBe(0.30000000000000004);
  });
});

describe('p04c fixture mapping', () => {
  it('maps empty, populated, paid-generated, plan-edit, legacy-vault, and large-history without mutating source ids', () => {
    const cases = ['empty', 'populated', 'paid-generated', 'plan-edit', 'legacy-vault', 'malformed', 'boundary'] as const;
    for (const name of cases) {
      const raw = fixture(`v1/${name}.json`);
      const extracted = snapshotFromP00Fixture(raw);
      expect(extracted.ok).toBe(true);
      if (!extracted.ok) continue;
      const before = JSON.stringify(extracted.snapshot);
      const plan = planLegacyMigration(extracted.snapshot);
      expect(JSON.stringify(extracted.snapshot)).toBe(before);
      expect(plan.currency).toBe('SAR');
      expect(plan.commands[0]?.command.kind).toBe('createBook');
    }
    const large = snapshotFromP00Fixture(fixture('v1/large-history.json'));
    expect(large.ok).toBe(true);
    if (large.ok) {
      const plan = planLegacyMigration(large.snapshot);
      expect(plan.commands.some((item) => item.command.kind === 'recordExpense')).toBe(true);
      expect(plan.commands.length).toBeGreaterThan(100);
    }
  });

  it('maps unpaid essentials to reserved obligations and other unpaid to planned-not-reserved', () => {
    const extracted = snapshotFromP00Fixture(fixture('v1/p04c/mixed-unpaid.json'));
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const plan = planLegacyMigration(extracted.snapshot);
    expect(plan.commands.some((item) => item.command.kind === 'createObligation' && item.sourceIds.includes('fake-unpaid-ess'))).toBe(true);
    expect(plan.commands.some((item) => item.command.kind === 'createObligation' && item.sourceIds.includes('fake-reserved-lux'))).toBe(true);
    expect(plan.commands.some((item) => item.command.kind === 'createRecurringPlan' && item.sourceIds.includes('fake-unpaid-lux'))).toBe(true);
    expect(plan.review.some((item) => item.reason === MIGRATION_REASON.provisionalEssentialReservation)).toBe(true);
    expect(plan.review.some((item) => item.reason === MIGRATION_REASON.plannedNotReserved)).toBe(true);
    expect(plan.budgetCarryInIds).toContain('2026-07');
  });

  it('quarantines duplicate settlements, missing settlements, overlap, and adversarial money', () => {
    const duplicate = snapshotFromP00Fixture(fixture('v1/p04c/duplicate-settlement.json'));
    if (duplicate.ok) {
      const plan = planLegacyMigration(duplicate.snapshot);
      expect(plan.review.some((item) => item.reason === MIGRATION_REASON.duplicateSettlement)).toBe(true);
      expect(plan.budgetCarryInIds).toEqual(['2026-07']);
    }
    const missing = snapshotFromP00Fixture(fixture('v1/p04c/missing-settlement.json'));
    if (missing.ok) {
      const plan = planLegacyMigration(missing.snapshot);
      expect(plan.review.some((item) => item.reason === MIGRATION_REASON.missingSettlement)).toBe(true);
      expect(plan.vaultFundingIds).toContain('fake-orphan-tx');
    }
    const overlap = snapshotFromP00Fixture(fixture('v1/p04c/overlap.json'));
    if (overlap.ok) {
      const plan = planLegacyMigration(overlap.snapshot);
      expect(plan.review.some((item) => item.reason === MIGRATION_REASON.overlappingOpeningSettlement)).toBe(true);
      expect(plan.openingVaultMinorUnits).toBe(20_000);
    }
    const adversarial = snapshotFromP00Fixture(fixture('v1/p04c/adversarial-money.json'));
    if (adversarial.ok) {
      const plan = planLegacyMigration(adversarial.snapshot);
      const reasons = new Set(plan.review.map((item) => item.reason));
      expect(reasons.has(MIGRATION_REASON.excessPrecision)).toBe(true);
      expect(reasons.has(MIGRATION_REASON.invalidSign)).toBe(true);
      expect(reasons.has(MIGRATION_REASON.ambiguousCurrency)).toBe(true);
      expect(reasons.has(MIGRATION_REASON.duplicateId)).toBe(true);
      expect(reasons.has(MIGRATION_REASON.invalidId)).toBe(true);
      expect(plan.commands.some((item) => item.sourceIds.includes('fake-excess'))).toBe(false);
    }
  });

  it('never infers goal allocations from labels or balances', () => {
    const extracted = snapshotFromP00Fixture(fixture('v1/populated.json'));
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const plan = planLegacyMigration(extracted.snapshot);
    expect(plan.commands.some((item) => item.command.kind === 'assignToGoal')).toBe(false);
    expect(plan.commands.some((item) => item.command.kind === 'createGoal')).toBe(true);
    expect(plan.vaultFundingIds.length).toBeGreaterThan(0);
  });

  it('keeps original values on every quarantine record', () => {
    const extracted = snapshotFromP00Fixture(fixture('v1/p04c/adversarial-money.json'));
    if (!extracted.ok) return;
    const plan = planLegacyMigration(extracted.snapshot);
    for (const item of plan.review) {
      expect(item.needsAttention).toBe(true);
      expect(item.originalValue !== undefined || item.source !== null).toBe(true);
    }
  });

  it('requires one-to-one vault links, honors targetMonthKey, and quarantines collisions', () => {
    const emptyLink = snapshotFromStores({
      settings: [
        { key: 'baseAllowance', value: 100 },
        {
          key: 'vault',
          value: { balance: 40, transactions: [{ id: 'tx-a', amount: 40, date: '2026-02-01', sourceMonthKey: '2026-01' }], goals: [] },
        },
        {
          key: 'monthEndSettlements',
          value: [{ previousMonthKey: '2026-01', decision: 'vault', targetMonthKey: '2026-02', surplus: 40, vaultTransactionId: '' }],
        },
      ],
      expenses: [{ id: 'exp-a', name: 'FAKE', expectedCost: 1, actualPaid: 1, isPaid: true, classification: 'essential', date: '2026-01-10' }],
    });
    const emptyPlan = planLegacyMigration(emptyLink);
    expect(emptyPlan.commands.some((item) => item.command.kind === 'disposeCycleRemainder' && item.command.disposition.kind === 'fundTracked')).toBe(false);
    expect(emptyPlan.review.some((item) => item.reason === MIGRATION_REASON.missingSettlement)).toBe(true);

    const reused = snapshotFromStores({
      settings: [
        { key: 'baseAllowance', value: 100 },
        {
          key: 'vault',
          value: { balance: 50, transactions: [{ id: 'tx-shared', amount: 50, date: '2026-03-01', sourceMonthKey: '2026-01' }], goals: [] },
        },
        {
          key: 'monthEndSettlements',
          value: [
            { previousMonthKey: '2026-01', decision: 'vault', targetMonthKey: '2026-02', surplus: 50, vaultTransactionId: 'tx-shared' },
            { previousMonthKey: '2026-02', decision: 'vault', targetMonthKey: '2026-03', surplus: 50, vaultTransactionId: 'tx-shared' },
          ],
        },
      ],
      expenses: [
        { id: 'exp-b', name: 'FAKE', expectedCost: 1, actualPaid: 1, isPaid: true, classification: 'essential', date: '2026-01-10' },
        { id: 'exp-c', name: 'FAKE', expectedCost: 1, actualPaid: 1, isPaid: true, classification: 'essential', date: '2026-02-10' },
        { id: 'exp-d', name: 'FAKE', expectedCost: 1, actualPaid: 1, isPaid: true, classification: 'essential', date: '2026-03-10' },
      ],
    });
    const reusedPlan = planLegacyMigration(reused);
    const tracked = reusedPlan.commands.filter((item) => item.command.kind === 'disposeCycleRemainder' && item.command.disposition.kind === 'fundTracked');
    expect(tracked).toHaveLength(0);
    expect(reusedPlan.review.some((item) => item.reason === MIGRATION_REASON.duplicateSettlement)).toBe(true);
    expect(reusedPlan.commands.filter((item) => item.command.kind === 'fundAllocationPool' && item.sourceIds.includes('tx-shared'))).toHaveLength(1);

    const wrongMonth = snapshotFromStores({
      settings: [
        { key: 'baseAllowance', value: 100 },
        { key: 'vault', value: { balance: 0, transactions: [], goals: [] } },
        {
          key: 'monthEndSettlements',
          value: [{ previousMonthKey: '2026-01', decision: 'budget', targetMonthKey: '2026-03', surplus: 20 }],
        },
      ],
      expenses: [
        { id: 'exp-jan', name: 'FAKE', expectedCost: 1, actualPaid: 1, isPaid: true, classification: 'essential', date: '2026-01-10' },
        { id: 'exp-feb', name: 'FAKE', expectedCost: 1, actualPaid: 1, isPaid: true, classification: 'essential', date: '2026-02-10' },
      ],
    });
    const wrongPlan = planLegacyMigration(wrongMonth);
    const carry = wrongPlan.commands.find((item) => item.command.kind === 'disposeCycleRemainder' && item.command.disposition.kind === 'carryIn');
    expect(carry).toBeUndefined();
    expect(wrongPlan.review.some((item) => item.reason === MIGRATION_REASON.contradictorySettlement)).toBe(true);
    expect(wrongPlan.budgetCarryInIds).not.toContain('2026-01');

    const left = `e${'x'.repeat(94)}`;
    const right = `e${'x'.repeat(93)}y`;
    expect(left).toHaveLength(95);
    expect(right).toHaveLength(95);
    const longIds = snapshotFromStores({
      settings: [{ key: 'baseAllowance', value: 50 }],
      expenses: [
        { id: left, name: 'FAKE long a', expectedCost: 2, actualPaid: 2, isPaid: true, classification: 'essential', date: '2026-08-02' },
        { id: right, name: 'FAKE long b', expectedCost: 3, actualPaid: 3, isPaid: true, classification: 'essential', date: '2026-08-03' },
      ],
    });
    const longPlan = planLegacyMigration(longIds);
    const expenseOps = longPlan.commands.filter((item) => item.command.kind === 'recordExpense');
    expect(expenseOps).toHaveLength(2);
    expect(new Set(expenseOps.map((item) => item.operationId)).size).toBe(2);
    expect(expenseOps.every((item) => item.operationId.length <= 100)).toBe(true);
  });

  it('uses checked money arithmetic and digests source identity including sourcePresent', async () => {
    const overflow = snapshotFromStores({
      settings: [
        { key: 'baseAllowance', value: Number.MAX_SAFE_INTEGER },
        { key: 'vault', value: { openingBalance: 1, balance: 1, transactions: [], goals: [] } },
      ],
    });
    const overflowPlan = planLegacyMigration(overflow);
    expect(overflowPlan.review.some((item) => item.reason === MIGRATION_REASON.unsafeAmount)).toBe(true);

    const presentEmpty = snapshotFromStores({ settings: [], templates: [], expenses: [], sourcePresent: true });
    const absent = snapshotFromStores({ settings: [], templates: [], expenses: [], sourcePresent: false });
    const presentDigest = sourceFingerprintOf(presentEmpty);
    const absentDigest = sourceFingerprintOf(absent);
    expect(presentDigest).toMatch(/^[0-9a-f]{16}$/);
    expect(presentDigest).not.toBe(absentDigest);
    expect(presentDigest.includes('{')).toBe(false);

    const withNaN = snapshotFromStores({ settings: [{ key: 'weird', value: Number.NaN }] });
    expect(Number.isNaN(withNaN.settings[0]?.value as number)).toBe(true);

    const denied = await extractLegacyIndexedDb({
      databases: async () => [{ name: 'MicroSaveOS_DB', version: 1 }],
      open() {
        const request: { onerror: ((event: Event) => void) | null; error: DOMException; onupgradeneeded: null; onsuccess: null; onblocked: null } = {
          onerror: null,
          onupgradeneeded: null,
          onsuccess: null,
          onblocked: null,
          error: new DOMException('indexeddb is corrupt', 'UnknownError'),
        };
        queueMicrotask(() => request.onerror?.(new Event('error')));
        return request as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe(MIGRATION_REASON.extractionFailure);

    const absentOpen = await extractLegacyIndexedDb({
      databases: async () => [],
      open() {
        const request: {
          onupgradeneeded: ((event: Event) => void) | null;
          onerror: null;
          onsuccess: null;
          onblocked: null;
          transaction: { abort: () => void };
        } = {
          onupgradeneeded: null,
          onerror: null,
          onsuccess: null,
          onblocked: null,
          transaction: { abort() {} },
        };
        queueMicrotask(() => request.onupgradeneeded?.(new Event('upgradeneeded')));
        return request as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory);
    expect(absentOpen.ok).toBe(true);
    if (absentOpen.ok) expect(absentOpen.snapshot.sourcePresent).toBe(false);

    const discoveryDenied = await extractLegacyIndexedDb({
      databases: async () => {
        throw new DOMException('permission denied', 'SecurityError');
      },
      open() {
        throw new Error('open must not run after discovery failure');
      },
    } as unknown as IDBFactory);
    expect(discoveryDenied.ok).toBe(false);
    if (!discoveryDenied.ok) {
      expect(discoveryDenied.reason === MIGRATION_REASON.quotaOrPrivate || discoveryDenied.reason === MIGRATION_REASON.extractionFailure).toBe(true);
      expect(discoveryDenied.detail).toMatch(/permission|discover/i);
    }
  });
});
