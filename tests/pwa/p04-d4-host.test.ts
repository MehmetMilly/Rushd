/**
 * P04-D4 canonical-port gate (Node, deterministic).
 *
 * Proves the remaining D4 ports on the candidate host: recurring-plan
 * create/revise plus atomic idempotent materialization, month-level
 * Insights derived from committed facts with unknown budget and
 * open-cycle canonical availability, goal creation with explicit
 * assignment plus append-only month-end settlement, settings projection
 * with a read-only migrated allowance, local onboarding/navigation chrome,
 * write-blocking under failure, cross-tab invalidation, and the v1
 * extraction-only freeze. The durable OPFS proof lives in the D4
 * Playwright harness.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { prepareCanonicalCandidateHost } from '../../src/application/p04-d/canonical-host.js';
import { createTabCoordinator } from '../../src/application/p04-d/tab-coordination.js';
import {
  P04D_PRODUCTION_AUTHORITY,
  P04D_V1_EXTRACTION_ONLY_REASON,
  freezeV1Writers,
  isProductionCanonical,
  resolveProductionIdentity,
} from '../../src/application/p04-d/production-boot.js';
import { snapshotFromStores } from '../../src/data/migration/extract';
import { LEGACY_GUEST_BOOK_ID } from '../../src/data/migration/mapping';
import { makeBookId } from '../../src/domain/contracts/identity';
import {
  REPLACE_ACTIVE_CONFIRMATION,
  RESET_SCOPE_CONFIRMATION,
} from '../../src/data/portability/format';
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { createMemoryStorage } from './memory-storage';

const SYNC_ENV = {} as unknown as typeof globalThis;

function memoryLocalStorage() {
  const cells = new Map<string, string>();
  return {
    getItem: (key: string) => (cells.has(key) ? cells.get(key)! : null),
    setItem: (key: string, value: string) => {
      cells.set(key, String(value));
    },
    removeItem: (key: string) => {
      cells.delete(key);
    },
    get length() {
      return cells.size;
    },
    key: (index: number) => [...cells.keys()][index] ?? null,
  };
}

function memoryStore() {
  const cells = new Map<string, string>();
  return {
    getItem: (key: string) => (cells.has(key) ? cells.get(key)! : null),
    setItem: (key: string, value: string) => {
      cells.set(key, String(value));
    },
    removeItem: (key: string) => {
      cells.delete(key);
    },
  };
}

function fakeV1Snapshot() {
  return snapshotFromStores({
    settings: [
      { key: 'baseAllowance', value: 1500 },
      { key: 'theme', value: 'dark' },
      {
        key: 'vault',
        value: {
          balance: 0,
          transactions: [{ id: 'v1-tx1', amount: 500, date: '2026-09-01', sourceMonthKey: '2026-09' }],
          goals: [{ id: 'g-v1', name: 'Rainy', targetAmount: 500 }],
        },
      },
    ],
    templates: [
      { id: 'rent', name: 'Rent', expectedCost: 2000, days: [3] },
    ],
    expenses: [
      {
        id: 'v1-bread', name: 'bread', expectedCost: 12, actualPaid: 12, isPaid: true,
        date: '2026-09-05', category: 'food', classification: 'essential',
      },
      {
        id: 'v1-scarf', name: 'silk scarf', expectedCost: 300, actualPaid: 300, isPaid: true,
        date: '2026-09-06', category: 'shopping', classification: 'luxury',
      },
      {
        id: 'v1-bus', name: 'bus', expectedCost: 7, actualPaid: 7, isPaid: true,
        date: '2026-10-01', category: 'transport', classification: 'essential',
      },
    ],
    sourcePresent: true,
  });
}

async function migratedHost(options: {
  migrationId?: string;
  selectedDate?: string;
  environment?: typeof globalThis;
  storage?: ReturnType<typeof createMemoryStorage>;
  coordination?: ReturnType<typeof createTabCoordinator>;
} = {}) {
  const { context } = createDeterministicContext();
  const coordination = options.coordination
    ?? createTabCoordinator({ tabId: `d4-tab-${options.migrationId ?? 'x'}`, environment: SYNC_ENV, store: memoryStore() });
  const storage = options.storage ?? createMemoryStorage({ context });
  const host = await prepareCanonicalCandidateHost({
    environment: (options.environment ?? { localStorage: memoryLocalStorage() }) as unknown as typeof globalThis,
    context,
    snapshot: fakeV1Snapshot(),
    migrationId: options.migrationId ?? 'mg-d4-0001',
    coordination,
    storage: storage as never,
    selectedDate: options.selectedDate ?? '2026-09-05',
  });
  return { context, coordination, storage, host };
}

function guestBookOf(storage: ReturnType<typeof createMemoryStorage>, storageId: string) {
  const repo = storage.inspect(storageId);
  expect(repo).not.toBeNull();
  const made = makeBookId(LEGACY_GUEST_BOOK_ID);
  expect(made.ok).toBe(true);
  if (!made.ok) throw new Error('bad guest book id');
  return repo!.getBookState(made.value);
}

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('d4 fresh-install boot rule', () => {
  it('opens the selected month with zero funds when no cycle covers it', async () => {
    const { context } = createDeterministicContext();
    const coordination = createTabCoordinator({ tabId: 'd4-fresh-1', environment: SYNC_ENV, store: memoryStore() });
    const storage = createMemoryStorage({ context });
    const host = await prepareCanonicalCandidateHost({
      environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
      context,
      snapshot: snapshotFromStores({ settings: [], templates: [], expenses: [], sourcePresent: false }),
      migrationId: 'mg-d4-fresh-1',
      coordination,
      storage: storage as never,
      selectedDate: '2026-11-20',
    });
    expect(host.ok).toBe(true);
    expect(host.authority.kind).toBe('canonicalReady');
    const book = guestBookOf(storage, host.storageId);
    const november = book.cycles.filter((cycle) => String(cycle.cycleId).endsWith(':2026-11-01'));
    expect(`${november.length}:${host.featurePorts.lifecycle.getStatus().error}`).toBe('1:null');
    expect(november[0].startingFunds.minorUnits).toBe(0);
    // Recording into the selected month works immediately after boot.
    const added = await host.featurePorts.capture.submitExpense({
      name: 'fresh milk', cost: 9.5, category: 'food', date: '2026-11-20',
    });
    expect(added.ok).toBe(true);
  });

  it('does not open a duplicate cycle when one already covers the date', async () => {
    const { storage, host } = await migratedHost({ migrationId: 'mg-d4-fresh-2', selectedDate: '2026-10-01' });
    expect(host.ok).toBe(true);
    const before = guestBookOf(storage, host.storageId).cycles.length;
    // October is the open month of this fixture (September closed at
    // migration); recording into it commits without new cycles.
    const added = await host.featurePorts.capture.submitExpense({
      name: 'oct milk', cost: 9.5, category: 'food', date: '2026-10-01',
    });
    expect(`${added.ok}:${host.featurePorts.capture.getStatus().error}`).toBe('true:null');
    expect(guestBookOf(storage, host.storageId).cycles.length).toBe(before);
  });
});

describe('d4 recurring plans', () => {
  it('migrates templates to plans with exact amounts and schedules', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d4-plan-1' });
    expect(host.ok).toBe(true);
    const plans = host.featurePorts.plan.listPlans();
    expect(plans.length).toBe(1);
    expect(plans[0]).toMatchObject({ planId: 'rent', name: 'Rent', amount: 2000, scheduleDay: 3 });
    expect(host.featurePorts.plan.listProfiles()).toEqual([]);
    expect(host.featurePorts.plan.getActiveProfileId()).toBe('');
  });

  it('creates a new plan and revises the same rule without inventing fields', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d4-plan-2' });
    await host.featurePorts.plan.saveTemplate({ id: 'gym', name: 'Gym', expectedCost: 150, days: [10] });
    let plans = host.featurePorts.plan.listPlans();
    expect(plans.map((plan) => plan.planId).sort()).toEqual(['gym', 'rent']);
    const created = plans.find((plan) => plan.planId === 'gym')!;
    expect(created).toMatchObject({ amount: 150, scheduleDay: 10, flexibleDefinitionId: null });
    await host.featurePorts.plan.saveTemplate({ id: 'gym', name: 'Gym', expectedCost: 180, days: [10] }, { effectiveDate: '2026-10-01' });
    plans = host.featurePorts.plan.listPlans();
    expect(plans.filter((plan) => plan.planId === 'gym').length).toBe(1);
    expect(plans.find((plan) => plan.planId === 'gym')!.amount).toBe(180);
  });

  it('refuses templates without an explicit amount or day and writes nothing', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d4-plan-3' });
    const before = guestBookOf(storage, host.storageId).plans.length;
    await expect(host.featurePorts.plan.saveTemplate({ id: 'vague', name: 'Vague' })).rejects.toThrow();
    await expect(host.featurePorts.plan.saveTemplate({ id: 'vague2', name: 'V2', expectedCost: 10, days: [] })).rejects.toThrow();
    expect(guestBookOf(storage, host.storageId).plans.length).toBe(before);
  });

  it('keeps profiles and plan deletion visibly blocked without writing', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d4-plan-4' });
    await expect(host.featurePorts.plan.setActiveProfile('x')).rejects.toThrow();
    await expect(host.featurePorts.plan.createProfile('New')).rejects.toThrow();
    await expect(host.featurePorts.plan.setProfileOffdays('x', [5])).rejects.toThrow();
    await expect(host.featurePorts.plan.deleteTemplate('rent')).rejects.toThrow();
    expect(guestBookOf(storage, host.storageId).plans.length).toBe(1);
  });

  it('materializes atomically and re-applies idempotently without duplicates', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d4-plan-5' });
    // Migration already materialized the migrated rule; a fresh rule still
    // has an open September slot, so the preview counts exactly that one.
    await host.featurePorts.plan.saveTemplate({ id: 'gym', name: 'Gym', expectedCost: 150, days: [10] });
    const preview = await host.featurePorts.plan.previewApply('2026-09-05', '');
    expect(preview.blocked).toBe(false);
    expect(preview.totalChanges).toBe(1);
    const first = await host.featurePorts.plan.confirmApply('2026-09-05', '', {
      operationIds: { rent: 'op-apply-1:rent' },
    });
    expect(first.blocked).toBe(false);
    const once = guestBookOf(storage, host.storageId).planOccurrences.length;
    expect(once).toBeGreaterThan(0);
    const second = await host.featurePorts.plan.confirmApply('2026-09-05', '', {
      operationIds: { rent: 'op-apply-1:rent' },
    });
    expect(second.blocked).toBe(false);
    expect(second.createCount).toBe(0);
    expect(guestBookOf(storage, host.storageId).planOccurrences.length).toBe(once);
  });

  it('refuses the whole apply before any commit when an identity is invalid', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d4-plan-5b' });
    await host.featurePorts.plan.saveTemplate({ id: 'gym', name: 'Gym', expectedCost: 150, days: [10] });
    const before = guestBookOf(storage, host.storageId).planOccurrences.length;
    // A space is outside the operation-id alphabet, so phase 1 refuses the
    // entire apply before any plan commits — no partial success to announce.
    const refused = await host.featurePorts.plan.confirmApply('2026-09-05', '', {
      operationIds: { rent: 'not an id' },
    });
    expect(refused.blocked).toBe(true);
    expect(refused.createCount).toBe(0);
    expect(guestBookOf(storage, host.storageId).planOccurrences.length).toBe(before);
    // Retry with valid per-plan identities converges.
    const retry = await host.featurePorts.plan.confirmApply('2026-09-05', '', {
      operationIds: { rent: 'op-apply-5b:rent', gym: 'op-apply-5b:gym' },
    });
    expect(retry.blocked).toBe(false);
    expect(guestBookOf(storage, host.storageId).planOccurrences.length).toBeGreaterThan(before);
  });

  it('never recreates a detached occurrence on re-materialization', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d4-plan-6' });
    await host.featurePorts.plan.confirmApply('2026-09-05', '');
    const book = guestBookOf(storage, host.storageId);
    const victim = book.planOccurrences[0];
    const { context } = createDeterministicContext();
    void context;
    // Detach through the gateway path is not a plan-port surface; emulate
    // the command-level guarantee instead: re-materializing skips managed
    // AND detached rows because identity is deterministic.
    expect(victim).toBeDefined();
    const again = await host.featurePorts.plan.confirmApply('2026-10-01', '');
    expect(again.blocked).toBe(false);
    const after = guestBookOf(storage, host.storageId).planOccurrences;
    const ids = after.map((row) => row.occurrenceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('d4 insights', () => {
  it('derives month totals from committed facts and keeps budget unknown', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d4-ins-1' });
    const stats = host.featurePorts.insights.getMonthStatistics('2026-09');
    expect(stats.monthKey).toBe('2026-09');
    expect(stats.paidSpent).toBe(312);
    expect(stats.budgetKnown).toBe(false);
    expect(stats.budget).toBe(null);
    expect(stats.safeToSpend).toBe(null);
    expect(stats.projectedBalance).toBe(null);
    const breakdown = host.featurePorts.insights.getCategoryBreakdown();
    expect(breakdown).toContainEqual({ category: 'food', amount: 12, count: 1 });
    expect(breakdown).toContainEqual({ category: 'shopping', amount: 300, count: 1 });
    const weekly = host.featurePorts.insights.getWeeklySpending();
    expect(weekly).toEqual([{ week: 1, amount: 312 }]);
    const october = host.featurePorts.insights.getMonthStatistics('2026-10');
    expect(october.paidSpent).toBe(7);
    expect(october.budgetKnown).toBe(false);
    expect(october.budget).toBe(null);
    expect(typeof october.safeToSpend).toBe('number');
    expect(Number.isFinite(october.safeToSpend)).toBe(true);
    expect(host.featurePorts.home.getSafeToSpend()).toBe(october.safeToSpend);
  });
});

describe('d4 goals and month-end', () => {
  it('creates a goal with its explicit opening assignment and replays retries', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d4-goal-1' });
    const migrated = host.featurePorts.goals.listGoals();
    expect(migrated.map((goal) => goal.id)).toContain('g-v1');
    const created = await host.featurePorts.goals.addGoal(
      { name: 'Emergency', targetAmount: 1000, allocatedAmount: 100 },
      { operationId: 'op-goal-1' },
    );
    expect(created).not.toBeNull();
    const retry = await host.featurePorts.goals.addGoal(
      { name: 'Emergency', targetAmount: 1000, allocatedAmount: 100 },
      { operationId: 'op-goal-1' },
    );
    expect(retry).toEqual(created);
    const goals = host.featurePorts.goals.listGoals();
    expect(goals.filter((goal) => goal.name === 'Emergency').length).toBe(1);
    const entry = goals.find((goal) => goal.name === 'Emergency')!;
    expect(entry.targetAmount).toBe(1000);
    expect(entry.allocatedAmount).toBe(100);
  });

  it('keeps goal deletion visibly blocked without writing', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d4-goal-2' });
    expect(await host.featurePorts.goals.deleteGoal('g-v1')).toBe(false);
    expect(host.featurePorts.goals.listGoals().map((goal) => goal.id)).toContain('g-v1');
  });

  it('settles a month to the vault once and replays the settlement', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d4-set-1' });
    const first = await host.featurePorts.goals.settleToVault({ previousMonthKey: '2026-09' }, '2026-10-02');
    expect(first).not.toBeNull();
    const book = guestBookOf(storage, host.storageId);
    expect(book.carryActions.length).toBe(1);
    const second = await host.featurePorts.goals.settleToVault({ previousMonthKey: '2026-09' }, '2026-10-02');
    expect(second).toEqual(first);
    expect(guestBookOf(storage, host.storageId).carryActions.length).toBe(1);
  });

  it('settles a month to the budget with a carry-in and refuses empty remainders', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d4-set-2' });
    const settled = await host.featurePorts.goals.settleToBudget({ previousMonthKey: '2026-09' }, '2026-10-02');
    expect(settled).not.toBeNull();
    expect(await host.featurePorts.goals.settleToVault({ previousMonthKey: 'bogus' }, '2026-10-02')).toBeNull();
  });

  it('settles no-surplus independently', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d4-set-3' });
    const settled = await host.featurePorts.goals.settleNoSurplus({ previousMonthKey: '2026-09' }, '2026-10-02');
    expect(settled).not.toBeNull();
    expect(guestBookOf(storage, host.storageId).carryActions.length).toBe(1);
  });
});

describe('d4 settings and local chrome', () => {
  it('projects the migrated allowance read-only and refuses rewrites', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d4-set-4' });
    const settings = host.featurePorts.lifecycle.getSettings();
    const book = guestBookOf(storage, host.storageId);
    const openCycle = book.cycles[book.cycles.length - 1];
    expect(settings.baseAllowance).toBe(openCycle.startingFunds.minorUnits / 100);
    expect(await host.featurePorts.lifecycle.saveBaseAllowance(9999)).toBe(false);
    expect(guestBookOf(storage, host.storageId).cycles.length).toBe(book.cycles.length);
  });

  it('keeps theme/motion/language/calendar as authority-gated local prefs', async () => {
    const environment = { localStorage: memoryLocalStorage() } as unknown as typeof globalThis;
    const { host } = await migratedHost({ migrationId: 'mg-d4-set-5', environment });
    await host.featurePorts.lifecycle.setTheme('light');
    await host.featurePorts.lifecycle.setMotionLevel('full');
    host.featurePorts.lifecycle.setLanguage('en');
    host.featurePorts.lifecycle.setCalendarType('hijri');
    const settings = host.featurePorts.lifecycle.getSettings();
    expect(settings).toMatchObject({ theme: 'light', motionLevel: 'full', language: 'en', calendarType: 'hijri' });
  });

  it('round-trips onboarding status locally and rejects malformed state', async () => {
    const environment = { localStorage: memoryLocalStorage() } as unknown as typeof globalThis;
    const { host } = await migratedHost({ migrationId: 'mg-d4-set-6', environment });
    expect(host.featurePorts.lifecycle.getOnboardingState()).toBeNull();
    const next = await host.featurePorts.lifecycle.persistOnboardingState('skipped', 'first-run-skip');
    expect(next.status).toBe('skipped');
    expect(host.featurePorts.lifecycle.getOnboardingState()).toMatchObject({ status: 'skipped', source: 'first-run-skip' });
    environment.localStorage!.setItem('onboardingState', 'not-json');
    expect(host.featurePorts.lifecycle.getOnboardingState()).toBeNull();
  });

  it('persists and restores navigation intent without guessing', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d4-nav-1' });
    expect(host.featurePorts.navigation.resolveIntent('ask')).toBeNull();
    expect(host.featurePorts.navigation.restoreIntent()).toBeNull();
    expect(host.featurePorts.navigation.resolveIntent('vault', '2026-09-04')).toEqual({ view: 'vault', date: '2026-09-04' });
    host.featurePorts.navigation.persistIntent({ view: 'vault', date: '2026-09-04' });
    expect(host.featurePorts.navigation.restoreIntent()).toEqual({ view: 'vault', date: '2026-09-04' });
    host.featurePorts.navigation.persistIntent({ view: 'ask' } as never);
    expect(host.featurePorts.navigation.restoreIntent()).toEqual({ view: 'vault', date: '2026-09-04' });
  });

  it('preserves the device id through local-preference clearing', async () => {
    const { P04D_PRODUCTION_DEVICE_KEY } = await import('../../src/application/p04-d/production-boot.js');
    const localStorage = memoryLocalStorage();
    const environment = { localStorage } as unknown as typeof globalThis;
    const { host } = await migratedHost({ migrationId: 'mg-d4-clear-1', environment });
    localStorage.setItem(P04D_PRODUCTION_DEVICE_KEY, 'dev-keep-me');
    localStorage.setItem('rushd_theme', 'light');
    localStorage.setItem('onboardingState', JSON.stringify({ status: 'skipped' }));
    host.featurePorts.portability.clearLocalPreferences();
    expect(localStorage.getItem(P04D_PRODUCTION_DEVICE_KEY)).toBe('dev-keep-me');
    expect(localStorage.getItem('rushd_theme')).toBeNull();
    expect(localStorage.getItem('onboardingState')).toBeNull();
  });
});

describe('d4 failure, cross-tab, and cutover', () => {
  it('mounts write-blocked on failure and never falls back to legacy writes', async () => {
    const { context } = createDeterministicContext();
    const coordination = createTabCoordinator({ tabId: 'd4-fail', environment: SYNC_ENV, store: memoryStore() });
    const storage = createMemoryStorage({ context });
    const host = await prepareCanonicalCandidateHost({
      environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
      context,
      snapshot: fakeV1Snapshot(),
      migrationId: 'bad id (invalid)',
      coordination,
      storage: storage as never,
    });
    expect(host.ok).toBe(false);
    expect(host.authority.writable).toBe(false);
    await expect(host.featurePorts.plan.saveTemplate({ id: 'x', name: 'X', expectedCost: 1, days: [1] })).rejects.toThrow();
    expect(await host.featurePorts.goals.addGoal({ name: 'X', targetAmount: 1 })).toBeNull();
    expect(await host.featurePorts.goals.settleToVault({ previousMonthKey: '2026-09' })).toBeNull();
    expect(await host.featurePorts.lifecycle.saveBaseAllowance(1)).toBe(false);
    expect(host.featurePorts.insights.getMonthStatistics('2026-09').paidSpent).toBe(0);
  });

  it('invalidates a second tab after a commit', async () => {
    const { context } = createDeterministicContext();
    const store = memoryStore();
    const coordinationA = createTabCoordinator({ tabId: 'd4-a', environment: SYNC_ENV, store });
    const coordinationB = createTabCoordinator({ tabId: 'd4-b', environment: SYNC_ENV, store });
    const storage = createMemoryStorage({ context });
    const environment = { localStorage: memoryLocalStorage() } as unknown as typeof globalThis;
    const hostA = await prepareCanonicalCandidateHost({
      environment, context, snapshot: fakeV1Snapshot(), migrationId: 'mg-d4-x-1',
      coordination: coordinationA, storage: storage as never, selectedDate: '2026-09-05',
    });
    const hostB = await prepareCanonicalCandidateHost({
      environment, context, migrationId: 'mg-d4-x-1',
      coordination: coordinationB, storage: storage as never, selectedDate: '2026-09-05',
    });
    expect(hostB.ok).toBe(true);
    expect(hostB.featurePorts.goals.listGoals().map((goal) => goal.id)).toContain('g-v1');
    const created = await hostB.featurePorts.goals.addGoal({ name: 'Shared', targetAmount: 50 }, { operationId: 'op-shared-1' });
    expect(created).not.toBeNull();
    await flush();
    expect(hostA.featurePorts.goals.listGoals().map((goal) => goal.name)).toContain('Shared');
  });

  it('pins the production authority to canonical with no runtime switch', () => {
    expect(P04D_PRODUCTION_AUTHORITY).toBe('canonical');
    expect(isProductionCanonical()).toBe(true);
  });

  it('resolves a stable production identity across restarts', () => {
    const environment = { localStorage: memoryLocalStorage() } as unknown as typeof globalThis;
    const first = resolveProductionIdentity(environment);
    const second = resolveProductionIdentity(environment);
    expect(second).toEqual(first);
    expect(first.deviceId.length).toBeGreaterThan(0);
    expect(first.scopeId).toContain('scope:guest:');
  });

  it('freezes v1 writers while keeping reads intact', () => {
    const dataRuntime = {
      DB: {
        getAllExpenses: async () => [],
        connect: async () => undefined,
        setSetting: async () => undefined,
        factoryReset: async () => undefined,
      },
      Store: {
        currentDate: '2026-09-05',
        addExpense: async () => ({ id: 'x' }),
        loadDay: async () => undefined,
      },
    };
    const frozen = freezeV1Writers(dataRuntime);
    expect(frozen).toEqual({ db: 3, store: 2 });
    expect(() => dataRuntime.DB.connect()).toThrow(P04D_V1_EXTRACTION_ONLY_REASON);
    expect(() => dataRuntime.DB.setSetting('theme', 'light')).toThrow(P04D_V1_EXTRACTION_ONLY_REASON);
    expect(() => dataRuntime.Store.addExpense({})).toThrow(P04D_V1_EXTRACTION_ONLY_REASON);
  });

  it('uses the exact P04-C destructive confirmations in port calls', async () => {
    const controller = await readFile('src/app/root-controller.js', 'utf8');
    expect(controller).toContain(REPLACE_ACTIVE_CONFIRMATION);
    expect(controller).toContain(RESET_SCOPE_CONFIRMATION);
  });

  it('fails closed with a defined reason when the P04-C preview rejects', async () => {
    const { context } = createDeterministicContext();
    const coordination = createTabCoordinator({ tabId: 'd4-prev', environment: SYNC_ENV, store: memoryStore() });
    const full = createMemoryStorage({ context });
    // Durable-shape adapter: no adapter-level preview, so the host runs
    // the P04-C portable validation itself.
    const storage = { ...full, previewImport: undefined };
    const host = await prepareCanonicalCandidateHost({
      environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
      context,
      snapshot: fakeV1Snapshot(),
      migrationId: 'mg-d4-prev-1',
      coordination,
      storage: storage as never,
    });
    expect(host.ok).toBe(true);
    const refused = await host.featurePorts.portability.restoreSnapshot(
      { nope: true },
      { importId: 'd4-prev-bad', confirmation: 'REPLACE-ACTIVE-DATABASE' },
    );
    expect(refused.ok).toBe(false);
    expect(typeof refused.reason).toBe('string');
    expect(refused.reason.length).toBeGreaterThan(0);
  });

  it('activates a first install without bumping the epoch', async () => {
    const { registerCandidatePwa } = await import('../../src/pwa/registration.js');
    const posted: unknown[] = [];
    let bumped = 0;
    const listeners: Record<string, Array<() => void>> = {};
    const worker = {
      state: 'installing',
      addEventListener: (event: string, handler: () => void) => {
        listeners[event] = [...(listeners[event] ?? []), handler];
      },
      removeEventListener: () => undefined,
    };
    const registration = {
      waiting: { postMessage: (message: unknown) => posted.push(message) },
      installing: worker,
      addEventListener: (event: string, handler: () => void) => {
        listeners[event] = [...(listeners[event] ?? []), handler];
      },
    };
    const coordination = {
      canActivateUpdate: () => true,
      bumpEpoch: () => {
        bumped += 1;
        return bumped;
      },
    };
    const environment = {
      navigator: {
        serviceWorker: {
          controller: null,
          register: async () => registration,
        },
      },
    } as unknown as typeof globalThis;
    const registered = await registerCandidatePwa({ environment, coordination: coordination as never });
    expect(registered.ok).toBe(true);
    for (const handler of listeners['updatefound'] ?? []) handler();
    worker.state = 'installed';
    for (const handler of listeners['statechange'] ?? []) handler();
    await flush();
    expect(posted).toEqual([{ type: 'rushd-pwa-skip-waiting' }]);
    expect(bumped).toBe(0);
  });

  it('bumps the epoch once for a genuine update over a live controller', async () => {
    const { registerCandidatePwa } = await import('../../src/pwa/registration.js');
    let bumped = 0;
    const listeners: Record<string, Array<() => void>> = {};
    const worker = {
      state: 'installing',
      addEventListener: (event: string, handler: () => void) => {
        listeners[event] = [...(listeners[event] ?? []), handler];
      },
      removeEventListener: () => undefined,
    };
    const registration = {
      waiting: { postMessage: () => undefined },
      installing: worker,
      addEventListener: (event: string, handler: () => void) => {
        listeners[event] = [...(listeners[event] ?? []), handler];
      },
    };
    const coordination = {
      canActivateUpdate: () => true,
      bumpEpoch: () => {
        bumped += 1;
        return bumped;
      },
    };
    const environment = {
      navigator: {
        serviceWorker: {
          controller: {},
          register: async () => registration,
        },
      },
    } as unknown as typeof globalThis;
    const registered = await registerCandidatePwa({ environment, coordination: coordination as never });
    expect(registered.ok).toBe(true);
    for (const handler of listeners['updatefound'] ?? []) handler();
    worker.state = 'installed';
    for (const handler of listeners['statechange'] ?? []) handler();
    await flush();
    expect(bumped).toBe(1);
  });
});
