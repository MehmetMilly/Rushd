// P04-D4 controller routing tests. Run: node tests/application/p04-d4-routing.test.mjs
/* global console:readonly, setImmediate:readonly */
//
// Proves every D4-owned controller action routes through exactly one
// canonical feature port in candidate mode and cannot reach the v1 `Store`/
// `DB` or raw `localStorage`, while legacy mode preserves its delegates.
// Part 1 is mechanical (source structure, like the D3 routing test); part 2
// drives the real installed controller methods with fake ports and a
// recording v1 runtime.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installRootController } from '../../src/app/root-controller.js';
import { TRANSLATIONS } from '../../src/app/i18n/translations.js';

const CONTROLLER_PATH = 'src/app/root-controller.js';
const source = await readFile(CONTROLLER_PATH, 'utf8');

// --- Part 1: mechanical routing structure --------------------------------

const D4_OWNED = Object.freeze([
  'confirmTemplateApplication',
  'createTemplateProfile',
  'deleteTemplate',
  'finishOnboarding',
  'persistOnboardingTemplateItems',
  'resolveOnboardingTargetProfileId',
  'setActiveTemplateProfile',
  'toggleCurrentProfileOffday',
  'reviewTemplateApplication',
  'addMonthEndSurplusToBudget',
  'addVaultGoal',
  'confirmDeleteVaultGoal',
  'maybeHandleMonthEndDecision',
  'moveMonthEndSurplusToVault',
  'clearRushdLocalState',
  'importData',
  'resetApp',
  'buildBackupSnapshot',
  'applyMotionProfile',
  'applyTheme',
  'clearMonthEndPromptDeferral',
  'clearMonthStartPromptDeferral',
  'decideMonthEndPromptLater',
  'decideMonthStartPromptLater',
  'deferMonthEndPrompt',
  'deferMonthStartPrompt',
  'getMonthStartPromptDeferral',
  'getMonthEndPromptDeferral',
  'handleApplyTemplatesModalVisibilityChange',
  'handleMonthEndModalVisibilityChange',
  'handleOnboardingModalVisibilityChange',
  'initApp',
  'maybeOpenMonthStartPrompt',
  'persistOnboardingState',
  'resolveOnboardingStatus',
  'saveSettings',
  'setCalendarType',
  'setLang',
  'setMotionLevel',
  'setTheme',
  'shouldShowMonthStartPrompt',
  'navigateTo',
  'reopenOnboardingFromSettings',
  'openOnboardingModal',
]);

const methodsStart = source.indexOf('methods: {');
assert.ok(methodsStart !== -1, 'controller must contain a methods block');
const methodsEnd = source.indexOf('mounted()', methodsStart);
assert.ok(methodsEnd !== -1, 'controller must contain mounted() after methods');
const methodsSource = source.slice(methodsStart, methodsEnd);

const HEADER_PATTERN = /^ {16}(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\((?:[^()]|\([^()]*\))*\)\s*\{\s*$/gm;
const headers = [];
for (const match of methodsSource.matchAll(HEADER_PATTERN)) {
  headers.push({ name: match[1], index: match.index });
}
const bodies = new Map();
for (let i = 0; i < headers.length; i += 1) {
  const start = headers[i].index;
  const end = i + 1 < headers.length ? headers[i + 1].index : methodsSource.length;
  bodies.set(headers[i].name, methodsSource.slice(start, end));
}

// Every D4-owned action must branch through the candidate seam before any
// legacy delegate can run.
for (const action of D4_OWNED) {
  assert.ok(bodies.has(action), `controller must still define ${action}`);
  assert.ok(
    bodies.get(action).includes('p04d'),
    `${action} must route through the P04-D candidate seam`,
  );
}

// skipOnboardingForNow is transitively owned: its only write delegates to
// the seamed persistOnboardingState (lifecycle port in candidate mode).
{
  const body = bodies.get('skipOnboardingForNow');
  assert.ok(body && body.includes('persistOnboardingState'), 'skipOnboardingForNow must delegate to the port-owned persistOnboardingState');
}

// Candidate branches must use the injected ports: each D4 writer references
// a port namespace in its seam branch.
for (const [action, namespaces] of [
  ['confirmTemplateApplicationViaPorts', ['ports.plan', 'Ports.plan']],
  ['reviewTemplateApplicationViaPorts', ['ports.plan', 'Ports.plan']],
  ['settleMonthEndViaPorts', ['ports.goals', 'CandidatePorts.goals']],
  ['addVaultGoalViaPorts', ['ports.goals', 'Ports.goals']],
  ['importDataViaPorts', ['ports.portability', 'CandidatePorts.portability']],
  ['resetAppViaPorts', ['ports.portability', 'CandidatePorts.portability']],
  ['selectDate', ['Ports.home']],
  ['initApp', ['Ports.lifecycle', 'Ports.navigation', 'Ports.insights', 'Ports.goals']],
]) {
  assert.ok(bodies.has(action), `controller must still define ${action}`);
  const body = bodies.get(action);
  assert.ok(
    namespaces.some((namespace) => body.includes(namespace)),
    `${action} must call its owning port`,
  );
}

// The template carries the truthful D4 disabled states and nothing else
// candidate-specific (no visual rewrite, no navigation change).
{
  const template = await readFile('src/app/root-template.html', 'utf8');
  for (const snippet of [
    '@change="saveSettings" :disabled="p04dCandidateActive"',
    '<select :value="store.settings.activeTemplateProfileId" :disabled="p04dCandidateActive"',
    '@click="createTemplateProfile" :disabled="p04dCandidateActive"',
    ':disabled="p04dCandidateActive"\n                                    @click="toggleCurrentProfileOffday(day.value)"',
    '@click.stop="deleteTemplate(tmpl.id)" :disabled="p04dCandidateActive"',
    ':disabled="p04dCandidateActive"\n                                                    @click="confirmDeleteVaultGoal(goal)"',
  ]) {
    assert.ok(template.includes(snippet), `template must visibly block D4-without-canonical-equivalent controls: ${snippet.slice(0, 60)}`);
  }
  assert.ok(!template.includes('canonicalCandidate'), 'template must not name build modes');
}

// The controller never resolves authority itself: no state literals.
assert.ok(!source.includes('canonicalReady'), 'controller must not name canonicalReady');
assert.ok(!source.includes('canonicalCandidate'), 'controller must not name canonicalCandidate');

// --- Part 2: runtime routing proof ----------------------------------------

function memoryLocalStorage() {
  const cells = new Map();
  return {
    getItem: (key) => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => {
      cells.set(key, String(value));
    },
    removeItem: (key) => {
      cells.delete(key);
    },
    clear: () => cells.clear(),
    get length() {
      return cells.size;
    },
    key: (index) => [...cells.keys()][index] ?? null,
  };
}

function makeRecordingRuntime() {
  const calls = [];
  let uuidCounter = 0;
  const store = {
    currentDate: '2026-09-05',
    currentViewExpenses: [],
    statistics: {
      budgetKnown: true,
      monthKey: '2026-09',
      paidSpent: 0,
      unpaidEssential: 0,
      safeToSpend: 100,
      projectedBalance: 0,
      categoryBreakdown: [],
      weeklySpending: [],
    },
    settings: {
      theme: 'dark',
      motionLevel: 'auto',
      baseAllowance: 1000,
      activeTemplateProfileId: 'legacy',
      templateProfiles: [{ id: 'legacy', name: 'Legacy', offdays: [5, 6] }],
      vault: { balance: 0, goals: [] },
    },
    templates: [],
    calls,
    loadDay: async (date) => {
      calls.push(['store.loadDay', date]);
      store.currentDate = date;
    },
    addExpense: async (expense) => {
      calls.push(['store.addExpense', expense]);
      return { id: 'v1-new' };
    },
    updateExpense: async (expense) => {
      calls.push(['store.updateExpense', expense]);
    },
    deleteExpense: async (id) => {
      calls.push(['store.deleteExpense', id]);
    },
    autoFillDay: async (date) => {
      calls.push(['store.autoFillDay', date]);
      return 1;
    },
    applyTemplatesFrom: async () => {
      calls.push(['store.applyTemplatesFrom']);
      return { blocked: false, summary: { totalChanges: 1 } };
    },
    buildTemplateApplyPlan: async () => {
      calls.push(['store.buildTemplateApplyPlan']);
      return { summary: {}, blocked: false };
    },
    addVaultGoal: async (goal) => {
      calls.push(['store.addVaultGoal', goal]);
      return { id: 'v1-goal' };
    },
    deleteVaultGoal: async (id) => {
      calls.push(['store.deleteVaultGoal', id]);
      return true;
    },
    settleMonthEndToVault: async () => {
      calls.push(['store.settleMonthEndToVault']);
      return {};
    },
    settleMonthEndToBudget: async () => {
      calls.push(['store.settleMonthEndToBudget']);
      return {};
    },
    refreshStatistics: async () => {
      calls.push(['store.refreshStatistics']);
    },
    refreshFlexibleStats: async () => {
      calls.push(['store.refreshFlexibleStats']);
    },
    init: async () => {
      calls.push(['store.init']);
    },
  };
  const db = {
    calls,
    setSetting: async (key, value) => {
      calls.push(['db.setSetting', key, value]);
    },
    getSetting: async () => {
      calls.push(['db.getSetting']);
      return null;
    },
    saveTemplate: async (template) => {
      calls.push(['db.saveTemplate', template]);
    },
    deleteTemplate: async (id) => {
      calls.push(['db.deleteTemplate', id]);
    },
    getAllExpenses: async () => {
      calls.push(['db.getAllExpenses']);
      return [];
    },
    getExpensesByDate: async () => {
      calls.push(['db.getExpensesByDate']);
      return [];
    },
    factoryReset: async () => {
      calls.push(['db.factoryReset']);
    },
  };
  return {
    calls,
    Store: store,
    DB: db,
    Core: {
      UUID: () => `test-uuid-${(() => { uuidCounter += 1; return uuidCounter; })()}`,
      Date: {
        getTodayISO: () => '2026-09-05',
        generateWindow: () => [],
      },
    },
    EXPENSE_SOURCE_VALUES: ['manual', 'flexible'],
    LEGACY_TEMPLATE_PROFILE: { id: 'legacy' },
    DEFAULT_PROFILE_OFFDAYS: [5, 6],
    MONTH_KEY_PATTERN: /^\d{4}-(0[1-9]|1[0-2])$/,
    MONTH_START_PROMPT_DEFER_KEY: 'rushd_month_start_prompt_deferred',
    MONTH_END_PROMPT_DEFER_KEY: 'rushd_month_end_prompt_deferred',
    ONBOARDING_STATE_KEY: 'onboardingState',
    getPreviousMonthKey: (date) => date.slice(0, 7) === '2026-09' ? '2026-08' : '2026-08',
    getMonthKey: (date) => (typeof date === 'string' ? date.slice(0, 7) : ''),
    getDefinitionProfileId: (record) => record?.profileId || 'legacy',
    normalizeDefinitionRecord: (template) => template,
    normalizeTemplateProfileRecord: (profile) => profile,
    normalizeTemplateProfiles: (profiles) => profiles,
    normalizeWeekdayIndex: (day) => (Number.isInteger(day) && day >= 0 && day <= 6 ? day : null),
    normalizeProfileOffdays: (days) => days,
    normalizeMotionLevel: (level) => level,
    parseMoneyInput: (value) => {
      if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
      const text = String(value ?? '').trim();
      if (!text) return null;
      const parsed = Number(text);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    },
    validateBackupPayload: () => ({ ok: true }),
  };
}

function makePorts(authorityState, behavior = {}) {
  const calls = [];
  return {
    calls,
    authority: {
      name: 'authority',
      getState: () => ({ ...authorityState }),
      assertWritable: (scope) => {
        if (!authorityState.writable) throw new Error(`blocked for '${scope}'`);
      },
      describe: () => authorityState.kind,
      getStatus: () => ({ busy: false, error: null }),
    },
    home: {
      name: 'home',
      getSelectedDate: () => behavior.selectedDate ?? '2026-09-05',
      getSafeToSpend: () => (behavior.safeToSpend === undefined ? null : behavior.safeToSpend),
      getDailyPaidTotal: () => 0,
      getDailyExpectedTotal: () => 0,
      listSelectedDayExpenses: () => [],
      selectDate: async (iso) => {
        calls.push(['home.selectDate', iso]);
      },
      refresh: async () => {
        calls.push(['home.refresh']);
      },
      getStatus: () => ({ busy: false, error: null }),
    },
    capture: {
      name: 'capture',
      submitExpense: async () => ({ ok: true, id: 'canon-1' }),
      payExpense: async () => ({ ok: false, reason: 'blocked' }),
      markUnpaid: async () => ({ ok: false, reason: 'blocked' }),
      autoFillDay: async () => 0,
      getStatus: () => ({ busy: false, error: null }),
    },
    history: {
      name: 'history',
      listDayExpenses: async () => [],
      updateExpense: async () => ({ ok: true, id: 'canon-2' }),
      deleteExpense: async () => ({ ok: true }),
      deleteSelected: async () => ({ ok: true }),
      markSelectedUnpaid: async () => ({ ok: false, reason: 'blocked' }),
      getStatus: () => ({ busy: false, error: null }),
    },
    plan: {
      name: 'plan',
      listProfiles: () => [],
      listPlans: () => behavior.plans ?? [],
      getActiveProfileId: () => '',
      setActiveProfile: async () => {
        throw new Error('profiles unavailable');
      },
      createProfile: async () => null,
      setProfileOffdays: async () => {
        throw new Error('profiles unavailable');
      },
      saveTemplate: async () => undefined,
      deleteTemplate: async () => {
        throw new Error('plans append-only');
      },
      saveFlexibleDefinition: async () => undefined,
      previewApply: async (effectiveDate) => {
        calls.push(['plan.previewApply', effectiveDate]);
        return behavior.planPreview ?? {
          rangeStart: effectiveDate, rangeEnd: effectiveDate, createCount: 1, updateCount: 0, deleteCount: 0, totalChanges: 1, blocked: false,
        };
      },
      confirmApply: async (effectiveDate, profileId, options) => {
        calls.push(['plan.confirmApply', effectiveDate, options]);
        return behavior.planConfirm ?? {
          rangeStart: effectiveDate, rangeEnd: effectiveDate, createCount: 1, updateCount: 0, deleteCount: 0, totalChanges: 1, blocked: false,
        };
      },
      getStatus: () => ({ busy: false, error: null }),
    },
    insights: {
      name: 'insights',
      getMonthStatistics: () => ({
        monthKey: '2026-09', budgetKnown: false, budget: null, paidSpent: 42, unpaidEssential: 0, safeToSpend: null, projectedBalance: null,
      }),
      getCategoryBreakdown: () => [{ category: 'food', amount: 42, count: 1 }],
      getWeeklySpending: () => [{ week: 1, amount: 42 }],
      refresh: async () => {
        calls.push(['insights.refresh']);
      },
      getStatus: () => ({ busy: false, error: null }),
    },
    goals: {
      name: 'goals',
      getVaultBalance: () => 7,
      listGoals: () => [{ id: 'g1', name: 'Rain', targetAmount: 100, allocatedAmount: 7 }],
      addGoal: async (goal, options) => {
        calls.push(['goals.addGoal', { ...goal }, options]);
        return behavior.goalResult ?? { id: 'goal-1' };
      },
      deleteGoal: async () => false,
      settleToVault: async (summary) => {
        calls.push(['goals.settleToVault', summary]);
        return behavior.settleResult ?? { settlementId: 'st-1' };
      },
      settleToBudget: async (summary) => {
        calls.push(['goals.settleToBudget', summary]);
        return behavior.settleResult ?? { settlementId: 'st-1' };
      },
      settleNoSurplus: async () => null,
      getStatus: () => ({ busy: false, error: null }),
    },
    portability: {
      name: 'portability',
      buildSnapshot: async () => {
        calls.push(['portability.buildSnapshot']);
        return '{"portable":true}';
      },
      restoreSnapshot: async (snapshot, options) => {
        calls.push(['portability.restoreSnapshot', options]);
        return behavior.restoreResult ?? { ok: true, reason: '' };
      },
      factoryReset: async (options) => {
        calls.push(['portability.factoryReset', options]);
        return undefined;
      },
      clearLocalPreferences: () => {
        calls.push(['portability.clearLocalPreferences']);
      },
      getStatus: () => ({ busy: false, error: null }),
    },
    navigation: {
      name: 'navigation',
      resolveIntent: (view, date) => {
        calls.push(['navigation.resolveIntent', view, date]);
        const known = ['dashboard', 'statistics', 'vault', 'plans', 'settings'];
        if (!known.includes(view)) return null;
        return date ? { view, date } : { view };
      },
      listDestinations: () => ['dashboard', 'statistics', 'vault', 'plans', 'settings'],
      persistIntent: (intent) => {
        calls.push(['navigation.persistIntent', intent]);
      },
      restoreIntent: () => behavior.restoredIntent ?? null,
      getStatus: () => ({ busy: false, error: null }),
    },
    lifecycle: {
      name: 'lifecycle',
      initialize: async () => {
        calls.push(['lifecycle.initialize']);
      },
      getSettings: () => ({
        baseAllowance: 1500, theme: 'dark', motionLevel: 'auto', language: 'ar', calendarType: 'gregorian', activeTemplateProfileId: '',
      }),
      saveBaseAllowance: async () => false,
      setTheme: async (theme) => {
        calls.push(['lifecycle.setTheme', theme]);
      },
      setMotionLevel: async (level) => {
        calls.push(['lifecycle.setMotionLevel', level]);
      },
      setLanguage: (language) => {
        calls.push(['lifecycle.setLanguage', language]);
      },
      setCalendarType: (calendarType) => {
        calls.push(['lifecycle.setCalendarType', calendarType]);
      },
      getOnboardingState: () => behavior.onboardingState ?? null,
      persistOnboardingState: async (status, src) => {
        calls.push(['lifecycle.persistOnboardingState', status, src]);
        return { status, updatedAt: '2026-09-05T00:00:00.000Z', source: src ?? '' };
      },
      getMonthStartDeferral: () => behavior.monthStartDeferral ?? null,
      deferMonthStartPrompt: (referenceDate) => {
        calls.push(['lifecycle.deferMonthStartPrompt', referenceDate]);
      },
      clearMonthStartDeferral: () => {
        calls.push(['lifecycle.clearMonthStartDeferral']);
      },
      getMonthEndDeferral: () => behavior.monthEndDeferral ?? null,
      deferMonthEndPrompt: (previousMonthKey, referenceDate) => {
        calls.push(['lifecycle.deferMonthEndPrompt', previousMonthKey, referenceDate]);
      },
      clearMonthEndDeferral: () => {
        calls.push(['lifecycle.clearMonthEndDeferral']);
      },
      getStatus: () => ({ busy: false, error: null }),
    },
  };
}

function installWith({ runtime, environment, ports }) {
  const mixins = [];
  const appStub = {
    config: { globalProperties: {} },
    mixin(m) {
      mixins.push(m);
    },
    component() {},
  };
  installRootController(appStub, runtime, environment, ports ? { featurePorts: ports } : {});
  const ctx = {
    $refs: {},
    $nextTick: () => {},
    store: runtime.Store,
    core: runtime.Core,
    lang: 'ar',
    t: TRANSLATIONS.ar,
    toasts: [],
    showToast(message) {
      this.toasts.push(message);
    },
  };
  for (const mixin of mixins) {
    if (mixin.data) Object.assign(ctx, mixin.data.call({}));
    if (mixin.methods) Object.assign(ctx, mixin.methods);
  }
  ctx.lang = 'ar';
  ctx.t = TRANSLATIONS.ar;
  ctx.toasts = [];
  ctx.showToast = function showToast(message) {
    this.toasts.push(message);
  };
  return ctx;
}

function makeEnvironment() {
  const storage = memoryLocalStorage();
  return {
    storage,
    localStorage: storage,
    document: {
      documentElement: { dataset: {}, style: {}, dir: '', lang: '' },
      querySelector: () => null,
    },
    navigator: {},
    window: { matchMedia: () => ({ matches: false }) },
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const READY = { kind: 'ready-stub', writable: true };
const BLOCKED = { kind: 'blocked-stub', writable: false };

// 1. Plan materialization commits through the port; v1 apply never runs.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY, { plans: [{ planId: 'rent' }] });
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.applyTemplatesModal.effectiveDate = '2026-09-05';
  ctx.applyTemplatesEffectiveDateValid = true;
  ctx.selectedApplyTemplatesProfileId = '';
  ctx.applyTemplatesModal.open = true;
  await ctx.confirmTemplateApplication.call(ctx);
  assert.deepEqual(runtime.calls, [], 'candidate apply must not reach Store/DB');
  const applied = ports.calls.filter(([name]) => name === 'plan.confirmApply');
  assert.equal(applied.length, 1, 'candidate apply must confirm exactly once');
  assert.deepEqual(Object.keys(applied[0][2].operationIds), ['rent'], 'one stable identity per plan');
  assert.equal(ctx.applyTemplatesModal.open, false, 'apply modal must close after durable success');
}

// 2. Apply preview reads through the port; v1 plan builder never runs.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY);
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.applyTemplatesEffectiveDateValid = true;
  await ctx.reviewTemplateApplication.call(ctx);
  assert.deepEqual(runtime.calls, [], 'candidate preview must not reach Store/DB');
  assert.ok(ports.calls.some(([name]) => name === 'plan.previewApply'), 'candidate preview must call the plan port');
}

// 3. Profiles, offdays, and template deletion stay blocked with zero v1 writes.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY);
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  await ctx.setActiveTemplateProfile.call(ctx, 'legacy');
  await ctx.createTemplateProfile.call(ctx);
  await ctx.toggleCurrentProfileOffday.call(ctx, 5);
  await ctx.deleteTemplate.call(ctx, 't1');
  assert.deepEqual(runtime.calls, [], 'blocked plan actions must not reach Store/DB');
  assert.equal(ctx.toasts.length, 4, 'each blocked plan action must toast once');
  assert.ok(ports.calls.every(([name]) => !name.startsWith('plan.') || name === 'plan.previewApply' || name === 'plan.confirmApply' || name === 'plan.listPlans'), 'blocked plan actions must not commit canonical facts');
}

// 4. Goal creation commits through the port with one operation identity.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY);
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.vaultGoalFormValid = true;
  ctx.vaultGoalForm = { name: 'Rain', targetAmount: '100', allocatedAmount: '' };
  ctx.resetVaultGoalForm = () => {};
  await ctx.addVaultGoal.call(ctx);
  assert.deepEqual(runtime.calls, [], 'candidate goal add must not reach Store/DB');
  const added = ports.calls.filter(([name]) => name === 'goals.addGoal');
  assert.equal(added.length, 1, 'candidate goal add must commit exactly once');
  assert.ok(typeof added[0][2]?.operationId === 'string', 'candidate goal add carries an operation identity');
  await ctx.confirmDeleteVaultGoal.call(ctx, { id: 'g1', name: 'Rain' });
  assert.deepEqual(runtime.calls, [], 'blocked goal delete must not reach Store/DB');
}

// 5. Month-end settlement commits through the goals port; auto-settle stays off.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY);
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.monthEndHasPositiveSurplus = true;
  ctx.monthEndModal.summary = { previousMonthKey: '2026-08' };
  ctx.monthEndModal.open = true;
  await ctx.moveMonthEndSurplusToVault.call(ctx);
  assert.deepEqual(runtime.calls, [], 'candidate settle must not reach Store/DB');
  assert.ok(ports.calls.some(([name]) => name === 'goals.settleToVault'), 'candidate settle must call the goals port');
  assert.equal(ctx.monthEndModal.open, false, 'settle modal must close after durable success');
  const auto = await ctx.maybeHandleMonthEndDecision.call(ctx, '2026-09-05');
  assert.equal(auto, false, 'auto month-end stays off in candidate mode');
  assert.deepEqual(runtime.calls, [], 'disabled auto-settle must not reach Store/DB');
}

// 6. Settings: allowance stays blocked; theme/motion/language/calendar route via ports.
{
  const runtime = makeRecordingRuntime();
  const environment = makeEnvironment();
  const ports = makePorts(READY);
  const ctx = installWith({ runtime, environment, ports });
  await ctx.saveSettings.call(ctx);
  assert.deepEqual(runtime.calls, [], 'blocked allowance save must not reach Store/DB');
  await ctx.setTheme.call(ctx, 'light');
  await ctx.setMotionLevel.call(ctx, 'full');
  await ctx.setLang.call(ctx, 'en');
  await ctx.setCalendarType.call(ctx, 'hijri');
  assert.deepEqual(runtime.calls, [], 'preference writes must not reach Store/DB');
  for (const name of ['lifecycle.setTheme', 'lifecycle.setMotionLevel', 'lifecycle.setLanguage', 'lifecycle.setCalendarType']) {
    assert.ok(ports.calls.some(([call]) => call === name), `candidate mode must call ${name}`);
  }
  assert.equal(environment.storage.getItem('rushd_theme'), null, 'candidate theme application must not write raw storage');
  assert.equal(environment.storage.getItem('rushd_motion'), null, 'candidate motion application must not write raw storage');
}

// 7. Deferrals route through the lifecycle port, never raw storage.
{
  const runtime = makeRecordingRuntime();
  const environment = makeEnvironment();
  const ports = makePorts(READY);
  const ctx = installWith({ runtime, environment, ports });
  await ctx.deferMonthStartPrompt.call(ctx, '2026-09-05');
  await ctx.deferMonthEndPrompt.call(ctx, '2026-08', '2026-09-05');
  await ctx.clearMonthStartPromptDeferral.call(ctx);
  await ctx.clearMonthEndPromptDeferral.call(ctx);
  await ctx.decideMonthStartPromptLater.call(ctx);
  await ctx.decideMonthEndPromptLater.call(ctx);
  assert.deepEqual(runtime.calls, [], 'deferral writes must not reach Store/DB');
  assert.equal(environment.storage.length, 0, 'deferral writes must not reach raw storage');
  for (const name of ['lifecycle.deferMonthStartPrompt', 'lifecycle.deferMonthEndPrompt', 'lifecycle.clearMonthStartDeferral', 'lifecycle.clearMonthEndDeferral']) {
    assert.ok(ports.calls.some(([call]) => call === name), `candidate mode must call ${name}`);
  }
  const start = await ctx.getMonthStartPromptDeferral.call(ctx);
  assert.equal(start, null, 'deferral reads come from the port');
  assert.equal(await ctx.shouldShowMonthStartPrompt.call(ctx, '2026-09-05'), false, 'month-start auto-prompt stays off');
}

// 8. Export/import/reset run through the portability port with commit-point semantics.
{
  const runtime = makeRecordingRuntime();
  const environment = makeEnvironment();
  const ports = makePorts(READY);
  const ctx = installWith({ runtime, environment, ports });
  const snapshot = await ctx.buildBackupSnapshot.call(ctx);
  assert.equal(snapshot, '{"portable":true}', 'candidate export must come from the port');
  assert.deepEqual(runtime.calls, [], 'candidate export must not reach Store/DB');
  await ctx.clearRushdLocalState.call(ctx);
  assert.ok(ports.calls.some(([name]) => name === 'portability.clearLocalPreferences'), 'preference clearing must call the port');
  assert.deepEqual(runtime.calls, [], 'preference clearing must not reach Store/DB');
}

// 9. Onboarding stays local: persist/resolve route via the port, setup stays blocked.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY, { onboardingState: { status: 'skipped', updatedAt: 'x', source: 'y' } });
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  await ctx.persistOnboardingState.call(ctx, 'skipped', 'first-run-skip');
  assert.ok(ports.calls.some(([name]) => name === 'lifecycle.persistOnboardingState'), 'onboarding persist must call the port');
  assert.equal(await ctx.resolveOnboardingStatus.call(ctx), 'skipped', 'onboarding status must resolve from the port');
  await ctx.finishOnboarding.call(ctx);
  await ctx.reopenOnboardingFromSettings.call(ctx);
  await ctx.openOnboardingModal.call(ctx, {});
  assert.deepEqual(runtime.calls, [], 'blocked onboarding must not reach Store/DB');
}

// 10. Navigation intent persists through the port; init restores it with zero v1 writes.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY, { restoredIntent: { view: 'vault', date: '2026-09-04' } });
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.isRoot = true;
  ctx.currentView = 'dashboard';
  await ctx.navigateTo.call(ctx, 'vault');
  assert.ok(ports.calls.some(([name]) => name === 'navigation.persistIntent'), 'navigation must persist the intent');
  await ctx.selectDate.call(ctx, '2026-09-04');
  assert.ok(ports.calls.filter(([name]) => name === 'navigation.persistIntent').length >= 2, 'date selection must persist the intent');
  assert.deepEqual(runtime.calls, [], 'navigation must not reach Store/DB');
}

// 11. Blocked authority keeps the shell mounted view-only: writers refuse before mutation.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(BLOCKED);
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.applyTemplatesModal.effectiveDate = '2026-09-05';
  ctx.applyTemplatesEffectiveDateValid = true;
  ctx.selectedApplyTemplatesProfileId = '';
  await ctx.confirmTemplateApplication.call(ctx);
  ctx.vaultGoalFormValid = true;
  ctx.vaultGoalForm = { name: 'Rain', targetAmount: '100', allocatedAmount: '' };
  ctx.resetVaultGoalForm = () => {};
  await ctx.addVaultGoal.call(ctx);
  assert.deepEqual(runtime.calls, [], 'blocked writers must not reach Store/DB');
  assert.ok(ctx.toasts.length >= 2, 'blocked writers must surface visibly');
  assert.ok(ports.calls.every(([name]) => !['plan.confirmApply', 'goals.addGoal'].includes(name)), 'blocked writers must not call committing ports');
}

// 12. Home mirrors canonical availability without claiming a monthly budget.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY, { safeToSpend: 1000 });
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  await ctx.selectDate.call(ctx, '2026-09-05');
  assert.equal(ctx.p04dSafeToSpend, 1000, 'canonical availability must reach the Home hero');
  assert.equal(ctx.store.statistics.budgetKnown, false, 'starting funds must not be claimed as a monthly budget');
  assert.deepEqual(runtime.calls, [], 'availability mirror must not read v1 finance state');
}

// 13. Legacy mode preserves its delegates exactly.
{
  const runtime = makeRecordingRuntime();
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports: null });
  ctx.templateProfiles = [{ id: 'legacy' }];
  await ctx.setActiveTemplateProfile.call(ctx, 'legacy');
  assert.deepEqual(runtime.calls, [['db.setSetting', 'activeTemplateProfileId', 'legacy'], ['store.refreshFlexibleStats']], 'legacy profile switch must keep its delegate');
}

console.log('p04-d4 routing passed');
