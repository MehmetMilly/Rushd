import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.env.RUSHD_BASELINE_WRITE !== '1') {
  console.error('Refusing to write immutable P00 fixtures without RUSHD_BASELINE_WRITE=1.');
  process.exit(2);
}

const outputRoot = resolve('tests/fixtures/v1');
const backupRoot = resolve(outputRoot, 'backups');
if (existsSync(outputRoot) && process.env.RUSHD_BASELINE_REPLACE !== '1') {
  console.error('P00 fixtures already exist. Set RUSHD_BASELINE_REPLACE=1 only for an explicitly reviewed replacement.');
  process.exit(3);
}
const frozenClock = '2026-08-10T09:00:00.000Z';
const fakeMarker = 'SYNTHETIC_P00_ONLY';

const baseSettings = (overrides = {}) => ({
  baseAllowance: 2400,
  safeToSpendMode: 'monthly',
  motionLevel: 'full',
  theme: 'dark',
  templateProfiles: [{ id: 'legacy', name: 'FAKE Default', offdays: [5, 6] }],
  activeTemplateProfileId: 'legacy',
  monthlyTemplateAssignments: [{ monthKey: '2026-08', assignedProfileId: 'legacy', effectiveDate: '2026-08-01' }],
  vault: { balance: 0, transactions: [], goals: [] },
  monthEndSettlements: [],
  onboardingState: { status: 'skipped', updatedAt: frozenClock, source: 'p00-fixture' },
  ...overrides
});

const settingsRecords = (settings) => Object.entries(settings).map(([key, value]) => ({ key, value }));

const expense = (id, date, overrides = {}) => ({
  id,
  name: `FAKE Expense ${id}`,
  expectedCost: 25,
  actualPaid: 0,
  isPaid: false,
  category: 'other',
  classification: 'essential',
  source: 'manual',
  flexibleDefinitionId: null,
  templateOriginId: null,
  templateProtected: true,
  date,
  timestamp: Date.parse(`${date}T09:00:00.000Z`),
  ...overrides
});

const template = (id, overrides = {}) => ({
  id,
  name: `FAKE Template ${id}`,
  expectedCost: 30,
  defaultAmount: 30,
  monthlyBudget: 0,
  maxUsesPerMonth: 0,
  category: 'other',
  classification: 'essential',
  source: 'template',
  recurrence: 'daily',
  applicability: 'everyday',
  profileId: 'legacy',
  days: [],
  ...overrides
});

const buildFixture = ({ caseId, description, settings = baseSettings(), templates = [], expenses = [], backupOverride = null, extra = {} }) => ({
  schema: 'rushd.v1-fixture.v1',
  case_id: caseId,
  description,
  sanitization: {
    marker: fakeMarker,
    contains_real_financial_data: false,
    generated_at: frozenClock
  },
  frozen_clock_utc: frozenClock,
  local_storage: {
    rushd_lang: 'ar',
    rushd_theme: settings.theme === 'light' ? 'light' : 'dark',
    rushd_motion: settings.motionLevel || 'full',
    rushd_calendar: 'gregorian'
  },
  indexed_db: {
    name: 'MicroSaveOS_DB',
    version: 1,
    stores: {
      settings: settingsRecords(settings),
      templates,
      expenses
    }
  },
  backup: backupOverride || {
    version: '3.1',
    exportedAt: frozenClock,
    settings,
    templates,
    expenses
  },
  ...extra
});

const populatedSettings = baseSettings({
  vault: {
    balance: 450,
    transactions: [{
      id: 'fake-vault-tx-001',
      type: 'surplus_transfer',
      amount: 450,
      date: '2026-08-01',
      monthKey: '2026-08',
      sourceMonthKey: '2026-07',
      createdAt: '2026-08-01T09:00:00.000Z'
    }],
    goals: [
      { id: 'fake-goal-laptop', name: 'FAKE Laptop', targetAmount: 1200 },
      { id: 'fake-goal-course', name: 'FAKE Course', targetAmount: 450 }
    ]
  },
  monthEndSettlements: [{
    previousMonthKey: '2026-07',
    decision: 'vault',
    targetMonthKey: '',
    surplus: 450,
    previousMonthBudget: 2400,
    previousMonthSpent: 1950,
    settledAt: '2026-08-01T09:00:00.000Z',
    vaultTransactionId: 'fake-vault-tx-001'
  }]
});

const populatedTemplates = [
  template('fake-template-transport', { name: 'FAKE Commute', expectedCost: 18, category: 'transport' }),
  template('fake-template-coffee', {
    name: 'FAKE Coffee', source: 'flexible', expectedCost: 20, defaultAmount: 20,
    monthlyBudget: 200, maxUsesPerMonth: 10, category: 'food'
  }),
  template('fake-template-internet', {
    name: 'FAKE Internet', expectedCost: 180, category: 'utilities', recurrence: 'monthly', days: [5]
  })
];

const populatedExpenses = [
  expense('fake-expense-001', '2026-08-10', { name: 'FAKE Groceries', expectedCost: 120, actualPaid: 112.5, isPaid: true, category: 'food' }),
  expense('fake-expense-002', '2026-08-10', { name: 'FAKE Internet', expectedCost: 180, category: 'utilities', source: 'template', templateOriginId: 'fake-template-internet', templateProtected: false }),
  expense('fake-expense-003', '2026-08-09', { name: 'FAKE Coffee', expectedCost: 20, actualPaid: 22, isPaid: true, category: 'food', classification: 'luxury', source: 'flexible', flexibleDefinitionId: 'fake-template-coffee', templateOriginId: 'fake-template-coffee' }),
  expense('fake-expense-004', '2026-08-08', { name: 'FAKE Bus', expectedCost: 18, actualPaid: 18, isPaid: true, category: 'transport' }),
  expense('fake-expense-005', '2026-07-28', { name: 'FAKE Previous Cycle', expectedCost: 80, actualPaid: 80, isPaid: true, category: 'other' })
];

const largeHistoryExpenses = Array.from({ length: 1000 }, (_, index) => {
  const date = new Date(Date.UTC(2024, 0, 1 + (index % 950))).toISOString().slice(0, 10);
  const expectedCost = ((index % 97) + 1) / 2;
  const paid = index % 4 !== 0;
  return expense(`fake-large-${String(index + 1).padStart(4, '0')}`, date, {
    name: `FAKE Ledger Entry ${String(index + 1).padStart(4, '0')}`,
    expectedCost,
    actualPaid: paid ? expectedCost + ((index % 5) - 2) / 10 : 0,
    isPaid: paid,
    category: ['food', 'transport', 'utilities', 'shopping', 'other'][index % 5],
    classification: index % 6 === 0 ? 'luxury' : 'essential'
  });
});

const fixtures = [
  buildFixture({
    caseId: 'empty',
    description: 'Empty initialized v1 database and valid empty 3.1 backup.',
    settings: baseSettings({ baseAllowance: 1000 }),
    templates: [],
    expenses: []
  }),
  buildFixture({
    caseId: 'populated',
    description: 'Representative fake paid, unpaid, essential, flexible, plan, vault, goal, and prior-cycle records.',
    settings: populatedSettings,
    templates: populatedTemplates,
    expenses: populatedExpenses
  }),
  buildFixture({
    caseId: 'paid-generated',
    description: 'Paid generated item remains marked mutable and reproduces paid plan-history mutation.',
    settings: baseSettings(),
    templates: [template('fake-paid-origin', { name: 'FAKE Renamed Commute', expectedCost: 55, category: 'transport' })],
    expenses: [expense('fake-paid-generated', '2026-08-10', {
      name: 'FAKE Original Commute', expectedCost: 40, actualPaid: 38, isPaid: true,
      category: 'food', source: 'template', templateOriginId: 'fake-paid-origin', templateProtected: false
    })]
  }),
  buildFixture({
    caseId: 'plan-edit',
    description: 'Plan edit includes mutable update/delete/create candidates and an effective-date/profile revision boundary.',
    settings: baseSettings({
      templateProfiles: [
        { id: 'legacy', name: 'FAKE Original Plan', offdays: [5, 6] },
        { id: 'fake-new-plan', name: 'FAKE Edited Plan', offdays: [4, 5] }
      ],
      activeTemplateProfileId: 'fake-new-plan',
      monthlyTemplateAssignments: [{ monthKey: '2026-08', assignedProfileId: 'legacy', effectiveDate: '2026-08-15' }]
    }),
    templates: [
      template('fake-update-template', { name: 'FAKE Updated Item', expectedCost: 75, profileId: 'fake-new-plan' }),
      template('fake-create-template', { name: 'FAKE New Item', expectedCost: 35, profileId: 'fake-new-plan' })
    ],
    expenses: [
      expense('fake-plan-update', '2026-08-16', { name: 'FAKE Old Item', source: 'template', templateOriginId: 'fake-update-template', templateProtected: false }),
      expense('fake-plan-delete', '2026-08-17', { name: 'FAKE Removed Item', source: 'template', templateOriginId: 'fake-removed-template', templateProtected: false })
    ]
  }),
  buildFixture({
    caseId: 'legacy-vault',
    description: 'Standalone legacy vault balance coexists with history and a first modern transfer.',
    settings: baseSettings({
      vault: {
        balance: 650,
        transactions: [{ id: 'fake-first-transfer', type: 'surplus_transfer', amount: 100, date: '2026-08-01', monthKey: '2026-08', sourceMonthKey: '2026-07', createdAt: '2026-08-01T09:00:00.000Z' }],
        goals: [{ id: 'fake-vault-goal', name: 'FAKE Emergency Goal', targetAmount: 900 }]
      }
    }),
    expenses: [expense('fake-vault-history', '2026-08-10', { actualPaid: 25, isPaid: true })]
  }),
  buildFixture({
    caseId: 'malformed',
    description: 'Malformed raw storage and backup candidates for import and numeric validation characterization.',
    settings: baseSettings({ baseAllowance: 'not-a-number', vault: { balance: -50, transactions: 'bad', goals: null } }),
    templates: [{ id: 'fake-malformed-template', name: '', expectedCost: 'Infinity', recurrence: 'monthly' }],
    expenses: [expense('fake-malformed-expense', 'not-a-date', { expectedCost: -1, actualPaid: 'NaN', isPaid: 'yes' })],
    backupOverride: { version: '3.1', exportedAt: 'not-a-date', expenses: [] },
    extra: {
      malformed_backup_candidates: [
        { id: 'missing-expenses', payload: { version: '3.1', settings: {} } },
        { id: 'non-array-expenses', payload: { version: '3.1', expenses: {} } },
        { id: 'weak-schema-accepted', payload: { expenses: [], settings: { baseAllowance: -5 }, templates: [{ bad: true }] } },
        { id: 'excess-precision', payload: { expenses: [{ id: 'fake-precision', expectedCost: 1.234, actualPaid: 0 }] } }
      ]
    }
  }),
  buildFixture({
    caseId: 'boundary',
    description: 'Timezone, short-month, precision, sign, size, and Arabic/Western numeral boundaries.',
    settings: baseSettings({ baseAllowance: 0.1 + 0.2 }),
    templates: [template('fake-month-end', { recurrence: 'monthly', days: [29, 30, 31] })],
    expenses: [
      expense('fake-utc-boundary-before', '2026-01-01', { expectedCost: 0.1, actualPaid: 0.1, isPaid: true }),
      expense('fake-utc-boundary-after', '2026-01-02', { expectedCost: 0.2, actualPaid: 0.2, isPaid: true }),
      expense('fake-negative', '2026-02-28', { expectedCost: -1 }),
      expense('fake-excess-precision', '2026-02-28', { expectedCost: 1.234 }),
      expense('fake-large-money', '2026-02-28', { expectedCost: 999999999.999 })
    ],
    extra: {
      boundary_inputs: ['0', '-1', '0.1', '0.2', '0.30000000000000004', '1.234', 'Infinity', 'NaN', '١٢٫٥٠', '12.50'],
      timezone_cases: [{ zone: 'Asia/Riyadh', instant: '2026-01-01T21:30:00.000Z', expected_local_date: '2026-01-02' }]
    }
  }),
  buildFixture({
    caseId: 'large-history',
    description: 'Deterministic 1,000-record fake history spanning multiple cycles for baseline performance.',
    settings: populatedSettings,
    templates: populatedTemplates,
    expenses: largeHistoryExpenses,
    extra: { expected_record_count: 1000 }
  })
];

await mkdir(outputRoot, { recursive: true });
await mkdir(backupRoot, { recursive: true });
for (const fixture of fixtures) {
  await writeFile(resolve(outputRoot, `${fixture.case_id}.json`), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  await writeFile(resolve(backupRoot, `${fixture.case_id}.backup.json`), `${JSON.stringify(fixture.backup, null, 2)}\n`, 'utf8');
}
const largeFixture = fixtures.find((fixture) => fixture.case_id === 'large-history');
await writeFile(resolve(backupRoot, 'large-history-100.backup.json'), `${JSON.stringify({
  ...largeFixture.backup,
  expenses: largeFixture.backup.expenses.slice(0, 100)
}, null, 2)}\n`, 'utf8');

console.log(`Generated ${fixtures.length} deterministic P00 fixtures in ${outputRoot}`);
