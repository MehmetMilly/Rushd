// P04-D1: legacy port set.
//
// Every port below delegates to the existing v1 `DB`/`Store` behavior owned
// by `src/data/legacy-v1/runtime.js`. These delegates MUST NOT reimplement
// finance calculations (budget, safe-to-spend, vault, statistics,
// recurring-template generation): they call the established Store/DB
// methods and pass values through. Thin view-model shaping (field
// passthrough, null guards) is allowed; arithmetic that restates money is
// not — the single exception is summing already-rendered day amounts for
// the Home totals, which D3 replaces with canonical read models.
//
// Nothing here opens v2 storage, starts a service worker, or contacts the
// network. Candidate/canonical ports arrive in D2-D4.
//
// Types live in `./contracts.js`; declarations are mirrored in
// `./legacy-ports.d.ts` for checked consumers.

/**
 * @typedef {import('./contracts.js').AuthorityPort} AuthorityPort
 * @typedef {import('./contracts.js').AuthorityState} AuthorityState
 * @typedef {import('./contracts.js').CaptureInput} CaptureInput
 * @typedef {import('./contracts.js').CapturePort} CapturePort
 * @typedef {import('./contracts.js').CaptureResult} CaptureResult
 * @typedef {import('./contracts.js').GoalsPort} GoalsPort
 * @typedef {import('./contracts.js').HistoryExpenseRecord} HistoryExpenseRecord
 * @typedef {import('./contracts.js').HistoryPort} HistoryPort
 * @typedef {import('./contracts.js').HomeDayExpense} HomeDayExpense
 * @typedef {import('./contracts.js').HomePort} HomePort
 * @typedef {import('./contracts.js').InsightsPort} InsightsPort
 * @typedef {import('./contracts.js').MonthEndSummaryInput} MonthEndSummaryInput
 * @typedef {import('./contracts.js').MonthStatisticsView} MonthStatisticsView
 * @typedef {import('./contracts.js').NavigationIntent} NavigationIntent
 * @typedef {import('./contracts.js').NavigationIntentPort} NavigationIntentPort
 * @typedef {import('./contracts.js').PlanPort} PlanPort
 * @typedef {import('./contracts.js').PortabilityPort} PortabilityPort
 * @typedef {import('./contracts.js').PortStatus} PortStatus
 * @typedef {import('./contracts.js').ShellFeaturePorts} ShellFeaturePorts
 * @typedef {import('./contracts.js').TemplateApplyPreview} TemplateApplyPreview
 * @typedef {import('./contracts.js').TemplateProfileView} TemplateProfileView
 * @typedef {import('./contracts.js').UpdateLifecyclePort} UpdateLifecyclePort
 * @typedef {import('./contracts.js').VaultGoalInput} VaultGoalInput
 * @typedef {import('../../data/legacy-v1/runtime.js').LegacyDataRuntime} LegacyDataRuntime
 * @typedef {Record<string, any>} UnknownRecord
 */

/**
 * @param {unknown} value
 * @returns {UnknownRecord}
 */
function asRecord(value) {
  if (typeof value === 'object' && value !== null) return value;
  return {};
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function toNumber(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function toStringValue(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function monthKeyFallback(value) {
  const text = toStringValue(value);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text.slice(0, 7)) ? text.slice(0, 7) : '';
}

/**
 * @param {LegacyDataRuntime} runtime
 * @param {unknown} referenceDate
 * @returns {string}
 */
function monthKeyFor(runtime, referenceDate) {
  const helper = getRuntimeHelper(runtime, 'getMonthKey');
  if (typeof helper === 'function') {
    try {
      const derived = helper.call(runtime, referenceDate);
      if (typeof derived === 'string' && derived) return derived;
    } catch {
      /* fall through to the slice fallback */
    }
  }
  return monthKeyFallback(referenceDate);
}

/**
 * @param {LegacyDataRuntime} runtime
 * @param {unknown} monthKey
 * @returns {boolean}
 */
function isMonthKey(runtime, monthKey) {
  const pattern = getRuntimeHelper(runtime, 'MONTH_KEY_PATTERN');
  if (pattern instanceof RegExp) return pattern.test(monthKey);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey);
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {LegacyDataRuntime} runtime
 * @returns {UnknownRecord}
 */
function getStore(runtime) {
  return asRecord(runtime.Store);
}

/**
 * @param {LegacyDataRuntime} runtime
 * @returns {UnknownRecord}
 */
function getDB(runtime) {
  return asRecord(runtime.DB);
}

/**
 * @param {LegacyDataRuntime} runtime
 * @param {string} key
 * @returns {unknown}
 */
function getRuntimeHelper(runtime, key) {
  return asRecord(runtime)[key];
}

/**
 * @param {UnknownRecord} target
 * @param {string} method
 * @param {unknown[]} [args]
 * @returns {unknown}
 */
function callMethod(target, method, args = []) {
  const fn = target[method];
  if (typeof fn !== 'function') {
    throw new Error(`legacy runtime has no method '${method}'`);
  }
  return fn.apply(target, args);
}

/**
 * @param {UnknownRecord} target
 * @param {string} method
 * @param {unknown[]} [args]
 * @returns {Promise<unknown>}
 */
async function callAsync(target, method, args = []) {
  return callMethod(target, method, args);
}

/**
 * @returns {{ get(): PortStatus, fail(message: string): void }}
 */
function createStatusCell() {
  let error = null;
  return {
    get() {
      return { busy: false, error };
    },
    fail(message) {
      error = message;
    },
  };
}

/**
 * @param {unknown} value
 * @returns {HomeDayExpense}
 */
function toHomeDayExpense(value) {
  const record = asRecord(value);
  return {
    id: toStringValue(record.id),
    name: toStringValue(record.name),
    expectedCost: toNumber(record.expectedCost, 0),
    actualPaid: toNumber(record.actualPaid, 0),
    isPaid: record.isPaid === true,
    category: toStringValue(record.category, 'other'),
    classification: toStringValue(record.classification, 'essential'),
    date: toStringValue(record.date),
  };
}

/**
 * @param {unknown} value
 * @returns {HistoryExpenseRecord}
 */
function toHistoryRecord(value) {
  const record = asRecord(value);
  return {
    ...record,
    id: toStringValue(record.id),
    date: toStringValue(record.date),
    name: toStringValue(record.name),
    expectedCost: toNumber(record.expectedCost, 0),
    actualPaid: toNumber(record.actualPaid, 0),
    isPaid: record.isPaid === true,
    category: toStringValue(record.category, 'other'),
    classification: toStringValue(record.classification, 'essential'),
  };
}

/**
 * @param {unknown} value
 * @returns {TemplateApplyPreview}
 */
function toApplyPreview(value) {
  const record = asRecord(value);
  const summary = asRecord(record.summary);
  const pick = (key) => toNumber(summary[key] ?? record[key], 0);
  return {
    rangeStart: toStringValue(summary.rangeStart ?? record.rangeStart),
    rangeEnd: toStringValue(summary.rangeEnd ?? record.rangeEnd),
    createCount: pick('createCount'),
    updateCount: pick('updateCount'),
    deleteCount: pick('deleteCount'),
    totalChanges: pick('totalChanges'),
    blocked: (record.blocked ?? summary.blocked) === true,
    blockedReason: toStringValue(record.blockedReason ?? summary.blockedReason, ''),
  };
}

/**
 * @param {string} [id]
 * @returns {CaptureResult}
 */
function okResult(id) {
  return id === undefined ? { ok: true } : { ok: true, id };
}

/**
 * @param {string} reason
 * @returns {CaptureResult}
 */
function failResult(reason) {
  return { ok: false, reason };
}

/**
 * @param {AuthorityState} initial
 * @param {{ get(): PortStatus }} status
 * @returns {AuthorityPort}
 */
const authorityBinders = new WeakMap();

function createAuthorityPort(initial, status) {
  let state = initial;
  const port = {
    name: 'authority',
    getState() {
      return state;
    },
    assertWritable(scope) {
      if (!state.writable) {
        throw new Error(`P04-D writes blocked for '${scope}': ${describeState(state)}`);
      }
    },
    describe() {
      return describeState(state);
    },
    getStatus() {
      return status.get();
    },
  };
  // D2 residual fix: the rebinding capability stays internal (WeakMap) and
  // never appears on the frozen public surface, so debug/test inspection
  // cannot relabel authority from the outside.
  authorityBinders.set(port, (next) => {
    state = next;
  });
  return Object.freeze(port);
}

/**
 * @param {AuthorityState} state
 * @returns {string}
 */
function describeState(state) {
  if (state.kind === 'legacy') return 'legacy (MicroSaveOS_DB v1 writable)';
  if (state.kind === 'canonicalPreparing') return `canonicalPreparing (blocked: ${state.reason})`;
  if (state.kind === 'canonicalReady') return `canonicalReady (storage ${state.storageId})`;
  return `unavailable (blocked: ${state.reason})`;
}

/**
 * @param {typeof globalThis} environment
 * @param {string} key
 * @returns {string | null}
 */
function readLocalStorage(environment, key) {
  try {
    const storage = environment.localStorage;
    if (!storage || typeof storage.getItem !== 'function') return null;
    return storage.getItem.call(storage, key);
  } catch {
    return null;
  }
}

/**
 * @param {typeof globalThis} environment
 * @param {string} key
 * @param {string} value
 * @returns {void}
 */
function writeLocalStorage(environment, key, value) {
  const storage = environment.localStorage;
  if (!storage || typeof storage.setItem !== 'function') return;
  storage.setItem.call(storage, key, value);
}

/**
 * @param {typeof globalThis} environment
 * @param {string} key
 * @returns {void}
 */
function removeLocalStorage(environment, key) {
  const storage = environment.localStorage;
  if (!storage || typeof storage.removeItem !== 'function') return;
  storage.removeItem.call(storage, key);
}

/**
 * Build the D1 legacy port set. Values are read from (and writes delegated
 * to) the provided v1 data runtime; `environment` is used only for the
 * pre-existing localStorage preference mirrors.
 * @param {LegacyDataRuntime} dataRuntime
 * @param {typeof globalThis} [environment]
 * @param {AuthorityState} [initialAuthority]
 * @returns {ShellFeaturePorts}
 */
export function createLegacyFeaturePorts(
  dataRuntime,
  environment = globalThis,
  initialAuthority = undefined,
) {
  const resolvedAuthority = initialAuthority ?? { kind: 'legacy', writable: true };
  const authorityStatus = createStatusCell();
  const authority = createAuthorityPort(resolvedAuthority, authorityStatus);

  const homeStatus = createStatusCell();
  /** @type {HomePort} */
  const home = {
    name: 'home',
    getSelectedDate() {
      return toStringValue(getStore(dataRuntime).currentDate);
    },
    getSafeToSpend() {
      const value = getStore(dataRuntime).safeToSpend;
      if (value === null || value === undefined) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    },
    getDailyPaidTotal() {
      return home
        .listSelectedDayExpenses()
        .filter((expense) => expense.isPaid)
        .reduce((sum, expense) => sum + expense.actualPaid, 0);
    },
    getDailyExpectedTotal() {
      return home
        .listSelectedDayExpenses()
        .reduce((sum, expense) => sum + expense.expectedCost, 0);
    },
    listSelectedDayExpenses() {
      return asArray(getStore(dataRuntime).currentViewExpenses).map(toHomeDayExpense);
    },
    async selectDate(isoDate) {
      try {
        await callAsync(getStore(dataRuntime), 'loadDay', [isoDate]);
      } catch (error) {
        homeStatus.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    async refresh() {
      const store = getStore(dataRuntime);
      const date = toStringValue(store.currentDate);
      try {
        if (typeof store.refreshFlexibleStats === 'function') {
          await callAsync(store, 'refreshFlexibleStats', [date]);
        }
        if (typeof store.refreshStatistics === 'function') {
          await callAsync(store, 'refreshStatistics', [date]);
        }
      } catch (error) {
        homeStatus.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    getStatus() {
      return homeStatus.get();
    },
  };

  const captureStatus = createStatusCell();
  /** @type {CapturePort} */
  const capture = {
    name: 'capture',
    async submitExpense(input) {
      try {
        authority.assertWritable('capture.submitExpense');
        if (!input || typeof input.name !== 'string' || !input.name.trim()) {
          return failResult('validation');
        }
        if (!Number.isFinite(input.cost) || input.cost < 0) return failResult('validation');
        const store = getStore(dataRuntime);
        const record = {
          name: input.name.trim(),
          expectedCost: input.cost,
          category: input.category || 'food',
          classification: input.classification || 'essential',
          source: input.source === 'flexible' ? 'flexible' : 'manual',
          flexibleDefinitionId:
            input.source === 'flexible' ? (input.flexibleDefinitionId ?? null) : null,
          actualPaid: 0,
          isPaid: false,
          date: input.date || toStringValue(store.currentDate),
        };
        await callAsync(store, 'addExpense', [record]);
        return okResult(toStringValue(record.id));
      } catch (error) {
        captureStatus.fail(error instanceof Error ? error.message : String(error));
        return failResult('error');
      }
    },
    async payExpense(id, amount) {
      try {
        authority.assertWritable('capture.payExpense');
        if (!id || !Number.isFinite(amount) || amount < 0) return failResult('validation');
        const db = getDB(dataRuntime);
        const all = asArray(await callAsync(db, 'getAllExpenses', []));
        const found = all.find((entry) => toStringValue(asRecord(entry).id) === id);
        if (!found) return failResult('validation');
        const next = { ...asRecord(found), isPaid: true, actualPaid: amount };
        await callAsync(getStore(dataRuntime), 'updateExpense', [clone(next)]);
        return okResult(id);
      } catch (error) {
        captureStatus.fail(error instanceof Error ? error.message : String(error));
        return failResult('error');
      }
    },
    async markUnpaid(id) {
      try {
        authority.assertWritable('capture.markUnpaid');
        if (!id) return failResult('validation');
        const db = getDB(dataRuntime);
        const all = asArray(await callAsync(db, 'getAllExpenses', []));
        const found = all.find((entry) => toStringValue(asRecord(entry).id) === id);
        if (!found) return failResult('validation');
        const next = { ...asRecord(found), isPaid: false, actualPaid: 0 };
        await callAsync(getStore(dataRuntime), 'updateExpense', [clone(next)]);
        return okResult(id);
      } catch (error) {
        captureStatus.fail(error instanceof Error ? error.message : String(error));
        return failResult('error');
      }
    },
    async autoFillDay(date) {
      authority.assertWritable('capture.autoFillDay');
      const created = await callAsync(getStore(dataRuntime), 'autoFillDay', [date]);
      return toNumber(created, 0);
    },
    getStatus() {
      return captureStatus.get();
    },
  };

  const historyStatus = createStatusCell();
  /** @type {HistoryPort} */
  const history = {
    name: 'history',
    async listDayExpenses(date) {
      const rows = asArray(await callAsync(getDB(dataRuntime), 'getExpensesByDate', [date]));
      return rows.map(toHistoryRecord);
    },
    async updateExpense(expense) {
      try {
        authority.assertWritable('history.updateExpense');
        if (!expense || !expense.id) return failResult('validation');
        await callAsync(getStore(dataRuntime), 'updateExpense', [clone({ ...expense })]);
        return okResult(expense.id);
      } catch (error) {
        historyStatus.fail(error instanceof Error ? error.message : String(error));
        return failResult('error');
      }
    },
    async deleteExpense(id) {
      try {
        authority.assertWritable('history.deleteExpense');
        if (!id) return failResult('validation');
        await callAsync(getStore(dataRuntime), 'deleteExpense', [id]);
        return okResult(id);
      } catch (error) {
        historyStatus.fail(error instanceof Error ? error.message : String(error));
        return failResult('error');
      }
    },
    async deleteSelected(ids) {
      try {
        authority.assertWritable('history.deleteSelected');
        const store = getStore(dataRuntime);
        for (const id of ids || []) {
          await callAsync(store, 'deleteExpense', [id]);
        }
        return okResult();
      } catch (error) {
        historyStatus.fail(error instanceof Error ? error.message : String(error));
        return failResult('error');
      }
    },
    async markSelectedUnpaid(ids) {
      try {
        authority.assertWritable('history.markSelectedUnpaid');
        const store = getStore(dataRuntime);
        const db = getDB(dataRuntime);
        const wanted = new Set(ids || []);
        const all = asArray(await callAsync(db, 'getAllExpenses', []));
        for (const entry of all) {
          const record = asRecord(entry);
          if (!wanted.has(toStringValue(record.id)) || record.isPaid !== true) continue;
          await callAsync(store, 'updateExpense', [
            clone({ ...record, isPaid: false, actualPaid: 0 }),
          ]);
        }
        return okResult();
      } catch (error) {
        historyStatus.fail(error instanceof Error ? error.message : String(error));
        return failResult('error');
      }
    },
    getStatus() {
      return historyStatus.get();
    },
  };

  const planStatus = createStatusCell();
  /** @type {PlanPort} */
  const plan = {
    name: 'plan',
    listProfiles() {
      const profiles = asArray(asRecord(getStore(dataRuntime).settings).templateProfiles);
      return profiles.map((entry) => {
        const record = asRecord(entry);
        return {
          id: toStringValue(record.id),
          name: toStringValue(record.name || record.id),
          offdays: asArray(record.offdays).map((day) => toNumber(day, 0)),
        };
      });
    },
    listPlans() {
      return asArray(getStore(dataRuntime).templates).map((entry) => {
        const record = asRecord(entry);
        const days = asArray(record.days).filter(
          (day) => Number.isInteger(day) && day >= 1 && day <= 31,
        );
        return {
          planId: toStringValue(record.id),
          name: toStringValue(record.name || record.id),
          amount: toNumber(record.expectedCost ?? record.defaultAmount, 0),
          scheduleDay: days.length > 0 ? days[0] : 1,
          effectiveDate: '',
          flexibleDefinitionId: record.source === 'flexible' ? toStringValue(record.id) : null,
          occurrenceCount: 0,
        };
      });
    },
    getActiveProfileId() {
      return toStringValue(asRecord(getStore(dataRuntime).settings).activeTemplateProfileId);
    },
    async setActiveProfile(profileId) {
      authority.assertWritable('plan.setActiveProfile');
      const store = getStore(dataRuntime);
      const profiles = plan.listProfiles();
      const resolved = profiles.some((profile) => profile.id === profileId)
        ? profileId
        : (profiles[0]?.id ?? profileId);
      asRecord(store.settings).activeTemplateProfileId = resolved;
      await callAsync(getDB(dataRuntime), 'setSetting', ['activeTemplateProfileId', resolved]);
      if (typeof store.refreshFlexibleStats === 'function') {
        await callAsync(store, 'refreshFlexibleStats', [toStringValue(store.currentDate)]);
      }
    },
    async createProfile(name) {
      try {
        authority.assertWritable('plan.createProfile');
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (!trimmed) return null;
        const core = asRecord(getRuntimeHelper(dataRuntime, 'Core') ?? {});
        const uuid = core.UUID;
        const id =
          typeof uuid === 'function'
            ? toStringValue(uuid.call(core))
            : `profile-${Date.now()}`;
        const defaultOffdays = asArray(getRuntimeHelper(dataRuntime, 'DEFAULT_PROFILE_OFFDAYS'));
        const profile = {
          id,
          name: trimmed,
          offdays: defaultOffdays.map((day) => toNumber(day, 0)),
        };
        const store = getStore(dataRuntime);
        const settings = asRecord(store.settings);
        settings.templateProfiles = [...plan.listProfiles(), profile];
        await callAsync(getDB(dataRuntime), 'setSetting', [
          'templateProfiles',
          clone(settings.templateProfiles),
        ]);
        await plan.setActiveProfile(id);
        return profile;
      } catch (error) {
        planStatus.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    async setProfileOffdays(profileId, offdays) {
      authority.assertWritable('plan.setProfileOffdays');
      const normalize = getRuntimeHelper(dataRuntime, 'normalizeProfileOffdays');
      const normalized = typeof normalize === 'function'
        ? normalize.call(dataRuntime, offdays)
        : offdays;
      const store = getStore(dataRuntime);
      const settings = asRecord(store.settings);
      const profiles = plan.listProfiles().map((profile) =>
        profile.id === profileId ? { ...profile, offdays: asArray(normalized).map((d) => toNumber(d, 0)) } : profile,
      );
      settings.templateProfiles = profiles;
      await callAsync(getDB(dataRuntime), 'setSetting', ['templateProfiles', clone(profiles)]);
    },
    async saveTemplate(template) {
      authority.assertWritable('plan.saveTemplate');
      await callAsync(getDB(dataRuntime), 'saveTemplate', [clone(asRecord(template))]);
    },
    async deleteTemplate(id) {
      authority.assertWritable('plan.deleteTemplate');
      await callAsync(getDB(dataRuntime), 'deleteTemplate', [id]);
      const store = getStore(dataRuntime);
      const templates = asArray(store.templates).filter(
        (entry) => toStringValue(asRecord(entry).id) !== id,
      );
      store.templates = templates;
    },
    async saveFlexibleDefinition(definition) {
      authority.assertWritable('plan.saveFlexibleDefinition');
      await callAsync(getDB(dataRuntime), 'saveTemplate', [clone(asRecord(definition))]);
    },
    async previewApply(effectiveDate, profileId) {
      const result = await callAsync(getStore(dataRuntime), 'buildTemplateApplyPlan', [
        effectiveDate,
        { profileId },
      ]);
      return toApplyPreview(result);
    },
    async confirmApply(effectiveDate, profileId) {
      authority.assertWritable('plan.confirmApply');
      const result = await callAsync(getStore(dataRuntime), 'applyTemplatesFrom', [
        effectiveDate,
        { profileId },
      ]);
      return toApplyPreview(result);
    },
    getStatus() {
      return planStatus.get();
    },
  };

  const insightsStatus = createStatusCell();
  /** @type {InsightsPort} */
  const insights = {
    name: 'insights',
    getMonthStatistics() {
      const stats = asRecord(getStore(dataRuntime).statistics);
      const budgetKnown = stats.budgetKnown !== false;
      const budget = stats.budget === null ? null : toNumber(stats.budget, 0);
      const safeToSpend = stats.safeToSpend === null || stats.safeToSpend === undefined
        ? null
        : toNumber(stats.safeToSpend, 0);
      return {
        ...stats,
        monthKey: toStringValue(stats.monthKey),
        budgetKnown,
        budget: budgetKnown ? budget : null,
        paidSpent: toNumber(stats.paidSpent, 0),
        unpaidEssential: toNumber(stats.unpaidEssential, 0),
        safeToSpend: budgetKnown ? safeToSpend : null,
        projectedBalance: budgetKnown ? toNumber(stats.projectedBalance, 0) : null,
      };
    },
    getCategoryBreakdown() {
      return asArray(asRecord(getStore(dataRuntime).statistics).categoryBreakdown).map((entry) => {
        const record = asRecord(entry);
        return {
          category: toStringValue(record.category, 'other'),
          amount: toNumber(record.amount, 0),
          count: Math.max(0, Math.floor(toNumber(record.count, 0))),
        };
      });
    },
    getWeeklySpending() {
      return asArray(asRecord(getStore(dataRuntime).statistics).weeklySpending).map((entry) => {
        const record = asRecord(entry);
        return { week: toNumber(record.week, 0), amount: toNumber(record.amount, 0) };
      });
    },
    async refresh(referenceDate) {
      const store = getStore(dataRuntime);
      const date = referenceDate || toStringValue(store.currentDate);
      await callAsync(store, 'refreshStatistics', [date]);
    },
    getStatus() {
      return insightsStatus.get();
    },
  };

  const goalsStatus = createStatusCell();
  /** @type {GoalsPort} */
  const goals = {
    name: 'goals',
    getVaultBalance() {
      return toNumber(asRecord(asRecord(getStore(dataRuntime).settings).vault).balance, 0);
    },
    listGoals() {
      return asArray(asRecord(asRecord(getStore(dataRuntime).settings).vault).goals).map((entry) => {
        const record = asRecord(entry);
        return {
          id: toStringValue(record.id),
          name: toStringValue(record.name),
          targetAmount: toNumber(record.targetAmount, 0),
          allocatedAmount: toNumber(record.allocatedAmount, 0),
        };
      });
    },
    async addGoal(goal) {
      try {
        authority.assertWritable('goals.addGoal');
        const created = await callAsync(getStore(dataRuntime), 'addVaultGoal', [clone({ ...goal })]);
        const record = asRecord(created);
        return record.id ? { id: toStringValue(record.id) } : null;
      } catch (error) {
        goalsStatus.fail(error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    async deleteGoal(goalId) {
      try {
        authority.assertWritable('goals.deleteGoal');
        const removed = await callAsync(getStore(dataRuntime), 'deleteVaultGoal', [goalId]);
        return removed === true;
      } catch (error) {
        goalsStatus.fail(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    async settleToVault(summary, referenceDate) {
      authority.assertWritable('goals.settleToVault');
      const store = getStore(dataRuntime);
      return callAsync(store, 'settleMonthEndToVault', [
        clone({ ...summary }),
        ...(referenceDate === undefined ? [] : [referenceDate]),
      ]);
    },
    async settleToBudget(summary, referenceDate) {
      authority.assertWritable('goals.settleToBudget');
      const store = getStore(dataRuntime);
      return callAsync(store, 'settleMonthEndToBudget', [
        clone({ ...summary }),
        ...(referenceDate === undefined ? [] : [referenceDate]),
      ]);
    },
    async settleNoSurplus(summary, referenceDate) {
      authority.assertWritable('goals.settleNoSurplus');
      const store = getStore(dataRuntime);
      return callAsync(store, 'settleMonthEndNoSurplus', [
        clone({ ...summary }),
        ...(referenceDate === undefined ? [] : [referenceDate]),
      ]);
    },
    getStatus() {
      return goalsStatus.get();
    },
  };

  const portabilityStatus = createStatusCell();
  /** @type {PortabilityPort} */
  const portability = {
    name: 'portability',
    async buildSnapshot() {
      const store = getStore(dataRuntime);
      const snapshot = {
        version: '3.1',
        exportedAt: new Date().toISOString(),
        settings: clone(store.settings),
        templates: clone(store.templates),
        expenses: await callAsync(getDB(dataRuntime), 'getAllExpenses', []),
      };
      return JSON.stringify(snapshot, null, 2);
    },
    async restoreSnapshot(snapshot) {
      try {
        authority.assertWritable('portability.restoreSnapshot');
        const validate = getRuntimeHelper(dataRuntime, 'validateBackupPayload');
        if (typeof validate !== 'function') {
          return { ok: false, reason: 'validator-unavailable' };
        }
        const validation = asRecord(validate.call(dataRuntime, snapshot));
        if (validation.ok !== true) {
          return { ok: false, reason: toStringValue(validation.reason, 'invalid') };
        }
        const payload = asRecord(snapshot);
        const importedSettings = asRecord(payload.settings);
        const normalizeMoney = getRuntimeHelper(dataRuntime, 'normalizePersistedMoney');
        const normalizeMotion = getRuntimeHelper(dataRuntime, 'normalizeMotionLevel');
        const normalizeAllowances = getRuntimeHelper(dataRuntime, 'normalizeMonthlyBaseAllowances');
        const money = (value) =>
          typeof normalizeMoney === 'function'
            ? normalizeMoney.call(dataRuntime, value)
            : value;
        const settingsEntries = [];
        if (importedSettings.baseAllowance !== undefined) {
          settingsEntries.push({ key: 'baseAllowance', value: money(importedSettings.baseAllowance) });
        }
        if (importedSettings.safeToSpendMode !== undefined) {
          settingsEntries.push({ key: 'safeToSpendMode', value: 'monthly' });
        }
        settingsEntries.push({
          key: 'motionLevel',
          value: typeof normalizeMotion === 'function'
            ? normalizeMotion.call(dataRuntime, importedSettings.motionLevel)
            : importedSettings.motionLevel,
        });
        if (importedSettings.theme) {
          settingsEntries.push({ key: 'theme', value: importedSettings.theme });
        }
        if (Array.isArray(importedSettings.templateProfiles)) {
          settingsEntries.push({ key: 'templateProfiles', value: importedSettings.templateProfiles });
        }
        if (importedSettings.activeTemplateProfileId) {
          settingsEntries.push({
            key: 'activeTemplateProfileId',
            value: importedSettings.activeTemplateProfileId,
          });
        }
        if (Array.isArray(importedSettings.monthlyTemplateAssignments)) {
          settingsEntries.push({
            key: 'monthlyTemplateAssignments',
            value: importedSettings.monthlyTemplateAssignments,
          });
        }
        if (importedSettings.vault) {
          settingsEntries.push({ key: 'vault', value: importedSettings.vault });
        }
        if (Array.isArray(importedSettings.monthEndSettlements)) {
          settingsEntries.push({
            key: 'monthEndSettlements',
            value: importedSettings.monthEndSettlements,
          });
        }
        const isPlainRecord = getRuntimeHelper(dataRuntime, 'isPlainObjectRecord');
        const hasAllowances = typeof isPlainRecord === 'function'
          ? isPlainRecord.call(dataRuntime, importedSettings.monthlyBaseAllowances)
          : (typeof importedSettings.monthlyBaseAllowances === 'object' &&
            importedSettings.monthlyBaseAllowances !== null);
        if (hasAllowances) {
          settingsEntries.push({
            key: 'monthlyBaseAllowances',
            value: typeof normalizeAllowances === 'function'
              ? normalizeAllowances.call(
                dataRuntime,
                importedSettings.monthlyBaseAllowances,
              )
              : importedSettings.monthlyBaseAllowances,
          });
        }
        await callAsync(getDB(dataRuntime), 'restoreBackupRecords', [
          {
            settingsEntries,
            templates: Array.isArray(payload.templates) ? payload.templates : [],
            expenses: payload.expenses,
          },
        ]);
        return { ok: true, reason: '' };
      } catch (error) {
        portabilityStatus.fail(error instanceof Error ? error.message : String(error));
        return { ok: false, reason: 'error' };
      }
    },
    async factoryReset(onBlocked = null) {
      authority.assertWritable('portability.factoryReset');
      await callAsync(getDB(dataRuntime), 'factoryReset', [onBlocked]);
    },
    clearLocalPreferences() {
      // D2 residual fix: local-preference removal is a write and stays
      // blocked while the authority is not writable.
      authority.assertWritable('portability.clearLocalPreferences');
      const storage = environment.localStorage;
      if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') return;
      const onboardingKey = toStringValue(
        getRuntimeHelper(dataRuntime, 'ONBOARDING_STATE_KEY'),
        'onboardingState',
      );
      const doomed = [];
      for (let index = 0; index < (storage.length ?? 0); index += 1) {
        const key = storage.key.call(storage, index);
        if (
          key &&
          // D4 correction: the persisted device id is storage namespacing,
          // not a UI preference; clearing must preserve it so the safety
          // backup stays re-importable after a reset.
          key !== 'rushd_device_id' &&
          (key.startsWith('rushd_') || key.startsWith('microsave_') || key === onboardingKey)
        ) {
          doomed.push(key);
        }
      }
      for (const key of doomed) {
        if (typeof storage.removeItem === 'function') storage.removeItem.call(storage, key);
      }
    },
    getStatus() {
      return portabilityStatus.get();
    },
  };

  const navigationStatus = createStatusCell();
  const destinations = [
    'dashboard',
    'statistics',
    'vault',
    'plans',
    'settings',
  ];
  /** @type {NavigationIntentPort} */
  const navigation = {
    name: 'navigation',
    resolveIntent(view, date) {
      const target = destinations.includes(view) ? view : null;
      if (!target) return null;
      const intent = { view: target };
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) intent.date = date;
      return intent;
    },
    listDestinations() {
      return [...destinations];
    },
    persistIntent(intent) {
      // UI route chrome only; persists even while finance writes are
      // blocked so offline destination recovery keeps working.
      try {
        const record = asRecord(intent);
        if (!destinations.includes(record.view)) return;
        const payload = { view: record.view };
        if (typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
          payload.date = record.date;
        }
        writeLocalStorage(environment, 'rushd_nav_intent', JSON.stringify(payload));
      } catch {
        /* intent persistence is best-effort chrome */
      }
    },
    restoreIntent() {
      try {
        const raw = readLocalStorage(environment, 'rushd_nav_intent');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!destinations.includes(parsed.view)) return null;
        const intent = { view: parsed.view };
        if (typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
          intent.date = parsed.date;
        }
        return intent;
      } catch {
        return null;
      }
    },
    getStatus() {
      return navigationStatus.get();
    },
  };

  const lifecycleStatus = createStatusCell();
  /** @type {UpdateLifecyclePort} */
  const lifecycle = {
    name: 'lifecycle',
    async initialize() {
      await callAsync(getStore(dataRuntime), 'init', []);
    },
    getSettings() {
      const settings = asRecord(getStore(dataRuntime).settings);
      return {
        ...settings,
        baseAllowance: toNumber(settings.baseAllowance, 1000),
        theme: toStringValue(settings.theme, 'dark'),
        motionLevel: toStringValue(settings.motionLevel, 'auto'),
        language: toStringValue(readLocalStorage(environment, 'rushd_lang'), 'ar') || 'ar',
        calendarType:
          toStringValue(readLocalStorage(environment, 'rushd_calendar'), 'gregorian') || 'gregorian',
        activeTemplateProfileId: toStringValue(settings.activeTemplateProfileId),
      };
    },
    async saveBaseAllowance(amount) {
      try {
        authority.assertWritable('lifecycle.saveBaseAllowance');
        const parse = getRuntimeHelper(dataRuntime, 'parseMoneyInput');
        const parsed = typeof parse === 'function'
          ? parse.call(dataRuntime, amount)
          : amount;
        if (parsed === null || parsed === undefined) return false;
        const store = getStore(dataRuntime);
        asRecord(store.settings).baseAllowance = parsed;
        await callAsync(getDB(dataRuntime), 'setSetting', ['baseAllowance', parsed]);
        if (typeof store.recordCurrentMonthBaseAllowance === 'function') {
          await callAsync(store, 'recordCurrentMonthBaseAllowance', []);
        }
        return true;
      } catch (error) {
        lifecycleStatus.fail(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    async setTheme(theme) {
      authority.assertWritable('lifecycle.setTheme');
      const resolved = theme === 'light' ? 'light' : 'dark';
      const store = getStore(dataRuntime);
      asRecord(store.settings).theme = resolved;
      writeLocalStorage(environment, 'rushd_theme', resolved);
      await callAsync(getDB(dataRuntime), 'setSetting', ['theme', resolved]);
    },
    async setMotionLevel(level) {
      authority.assertWritable('lifecycle.setMotionLevel');
      const normalize = getRuntimeHelper(dataRuntime, 'normalizeMotionLevel');
      const resolved = typeof normalize === 'function'
        ? toStringValue(normalize.call(dataRuntime, level), 'auto')
        : level;
      const store = getStore(dataRuntime);
      asRecord(store.settings).motionLevel = resolved;
      writeLocalStorage(environment, 'rushd_motion', resolved);
      await callAsync(getDB(dataRuntime), 'setSetting', ['motionLevel', resolved]);
    },
    setLanguage(language) {
      // D2 residual fix: preference mirrors are writes gated by authority.
      authority.assertWritable('lifecycle.setLanguage');
      writeLocalStorage(environment, 'rushd_lang', language);
    },
    setCalendarType(calendarType) {
      // D2 residual fix: see setLanguage.
      authority.assertWritable('lifecycle.setCalendarType');
      writeLocalStorage(environment, 'rushd_calendar', calendarType);
    },
    getOnboardingState() {
      return null;
    },
    async persistOnboardingState(status, source = '') {
      authority.assertWritable('lifecycle.persistOnboardingState');
      const next = {
        status,
        updatedAt: new Date().toISOString(),
        source: typeof source === 'string' ? source : '',
      };
      await callAsync(getDB(dataRuntime), 'setSetting', [
        toStringValue(getRuntimeHelper(dataRuntime, 'ONBOARDING_STATE_KEY'), 'onboardingState'),
        clone(next),
      ]);
      return next;
    },
    getMonthStartDeferral() {
      try {
        const key = toStringValue(
          getRuntimeHelper(dataRuntime, 'MONTH_START_PROMPT_DEFER_KEY'),
          'rushd_month_start_prompt_deferred',
        );
        const parsed = JSON.parse(readLocalStorage(environment, key) || 'null');
        // D2 residual fix: validate the controller's { monthKey, dateStr }
        // shape instead of passing raw JSON through.
        if (!parsed || typeof parsed !== 'object') return null;
        const monthKey = typeof parsed.monthKey === 'string' ? parsed.monthKey : '';
        const dateStr = typeof parsed.dateStr === 'string' ? parsed.dateStr : '';
        if (!isMonthKey(dataRuntime, monthKey) || !dateStr) return null;
        return { monthKey, dateStr };
      } catch {
        return null;
      }
    },
    deferMonthStartPrompt(referenceDate) {
      // D2 residual fix: gated like every other write, and persists the
      // controller's { monthKey, dateStr } shape.
      authority.assertWritable('lifecycle.deferMonthStartPrompt');
      const key = toStringValue(
        getRuntimeHelper(dataRuntime, 'MONTH_START_PROMPT_DEFER_KEY'),
        'rushd_month_start_prompt_deferred',
      );
      writeLocalStorage(
        environment,
        key,
        JSON.stringify({ monthKey: monthKeyFor(dataRuntime, referenceDate), dateStr: referenceDate }),
      );
    },
    clearMonthStartDeferral() {
      // D2 residual fix: deferral removal is a write gated by authority.
      authority.assertWritable('lifecycle.clearMonthStartDeferral');
      removeLocalStorage(
        environment,
        toStringValue(
          getRuntimeHelper(dataRuntime, 'MONTH_START_PROMPT_DEFER_KEY'),
          'rushd_month_start_prompt_deferred',
        ),
      );
    },
    getMonthEndDeferral() {
      try {
        const key = toStringValue(
          getRuntimeHelper(dataRuntime, 'MONTH_END_PROMPT_DEFER_KEY'),
          'rushd_month_end_prompt_deferred',
        );
        const parsed = JSON.parse(readLocalStorage(environment, key) || 'null');
        // D2 residual fix: validate the controller's
        // { previousMonthKey, dateStr } shape.
        if (!parsed || typeof parsed !== 'object') return null;
        const previousMonthKey = typeof parsed.previousMonthKey === 'string'
          ? parsed.previousMonthKey
          : '';
        const dateStr = typeof parsed.dateStr === 'string' ? parsed.dateStr : '';
        if (!isMonthKey(dataRuntime, previousMonthKey) || !dateStr) return null;
        return { previousMonthKey, dateStr };
      } catch {
        return null;
      }
    },
    deferMonthEndPrompt(previousMonthKey, referenceDate) {
      // D2 residual fix: gated like every other write.
      authority.assertWritable('lifecycle.deferMonthEndPrompt');
      const key = toStringValue(
        getRuntimeHelper(dataRuntime, 'MONTH_END_PROMPT_DEFER_KEY'),
        'rushd_month_end_prompt_deferred',
      );
      writeLocalStorage(
        environment,
        key,
        JSON.stringify({ previousMonthKey, dateStr: referenceDate }),
      );
    },
    clearMonthEndDeferral() {
      // D2 residual fix: deferral removal is a write gated by authority.
      authority.assertWritable('lifecycle.clearMonthEndDeferral');
      removeLocalStorage(
        environment,
        toStringValue(
          getRuntimeHelper(dataRuntime, 'MONTH_END_PROMPT_DEFER_KEY'),
          'rushd_month_end_prompt_deferred',
        ),
      );
    },
    getStatus() {
      return lifecycleStatus.get();
    },
  };

  // D2 residual fix: the public port surface is immutable. Internal state
  // (authority binding, status cells) lives in closures reached only through
  // `bindAuthorityState`, never through a mutable property.
  const ports = {
    authority,
    home,
    capture,
    history,
    plan,
    insights,
    goals,
    portability,
    navigation,
    lifecycle,
  };
  for (const port of Object.values(ports)) {
    if (port && typeof port === 'object') Object.freeze(port);
  }
  return Object.freeze(ports);
}

/**
 * Bind a resolved authority state to an existing legacy port set. D1
 * scaffolding: the mounted controller keeps delegating to the legacy ports
 * while the latch state travels with them for tests and reports. D4 replaces
 * this with immutable canonical ports at the cutover.
 *
 * D2 residual fix: binding uses the internal WeakMap capability created by
 * `createLegacyFeaturePorts`, so the public surface stays frozen. A foreign
 * injected set that still exposes a legacy `bind` function is honored for
 * backwards compatibility; anything else is left untouched.
 * @param {ShellFeaturePorts} ports
 * @param {AuthorityState} state
 * @returns {void}
 */
export function bindAuthorityState(ports, state) {
  const authority = ports ? ports.authority : undefined;
  if (!authority || typeof authority !== 'object') return;
  const internal = authorityBinders.get(authority);
  if (typeof internal === 'function') {
    internal(state);
    return;
  }
  if (typeof authority.bind === 'function') {
    authority.bind(state);
  }
}
