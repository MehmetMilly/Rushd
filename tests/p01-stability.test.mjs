// P01 Task 3 — stability and proof regressions.
//
// Covers the remaining P01 risk rows against the real production script
// blocks in index.html: local civil dates (P1-01), historical budget
// rewriting (P1-03), the fake weekly pace (P1-05), monthly schedule days
// (P1-06), assignment effective dates (P1-07), stale derived state (P1-08),
// mock analytics (P1-11), and the harmful reward basis (P1-12).
//
// The date block runs in a child process pinned to Asia/Riyadh so the
// recorded midnight-boundary reproduction is deterministic regardless of
// the host timezone.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadRushdRuntime } from './harness/load-rushd-runtime.mjs';

const thisFile = fileURLToPath(import.meta.url);
const readSource = () => readFile('index.html', 'utf8');
const waitTick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function runTimezoneAssertions() {
    const runtime = await loadRushdRuntime();
    const CoreDate = runtime.context.RushdCore.Date;

    // P1-01 recorded reproduction: 2026-01-01T21:30:00.000Z is already
    // 2026-01-02 for a user in Asia/Riyadh.
    const boundary = new Date('2026-01-01T21:30:00.000Z');
    const riyadh = (instant) => new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(instant);
    assert.equal(riyadh(boundary), '2026-01-02');
    assert.equal(CoreDate.toLocalISO(boundary), '2026-01-02');

    // One second before Riyadh midnight is still the previous civil day.
    assert.equal(CoreDate.toLocalISO(new Date('2026-01-01T20:59:59.000Z')), '2026-01-01');

    // The live "today" production helper agrees with the Riyadh civil date.
    let todayMatches = false;
    for (let attempt = 0; attempt < 3 && !todayMatches; attempt += 1) {
        todayMatches = CoreDate.getTodayISO() === riyadh(new Date());
        if (!todayMatches) await waitTick();
    }
    assert.equal(todayMatches, true, 'getTodayISO must follow the local civil day');

    // addDays performs local calendar arithmetic across month boundaries.
    assert.equal(CoreDate.addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(CoreDate.addDays('2026-03-01', -1), '2026-02-28');

    // Weekday-dependent behavior (KSA Fri/Sat weekend) follows the civil day.
    const friday = CoreDate.generateWindow('2026-01-02', 0, 0, 'en-US');
    assert.equal(friday.length, 1);
    assert.equal(friday[0].iso, '2026-01-02');
    assert.equal(friday[0].isWeekend, true);
    const thursday = CoreDate.generateWindow('2026-01-01', 0, 0, 'en-US');
    assert.equal(thursday[0].isWeekend, false);

    // humanize uses local yesterday/tomorrow.
    const today = CoreDate.getTodayISO();
    assert.equal(CoreDate.humanize(today), 'Today');
    assert.equal(CoreDate.humanize(CoreDate.addDays(today, -1)), 'Yesterday');
    assert.equal(CoreDate.humanize(CoreDate.addDays(today, 1)), 'Tomorrow');

    // Review fix: the backup filename must be built from the local civil-date
    // helper, not from a UTC timestamp. Prove the production wiring by pinning
    // the shared helper to the recorded Riyadh boundary civil date.
    const originalGetTodayISO = CoreDate.getTodayISO;
    CoreDate.getTodayISO = () => '2026-01-02';
    try {
        const methods = runtime.captured.mixins.find(mixin => mixin.methods?.downloadBackupFile).methods;
        await methods.downloadBackupFile.call({}, '{}');
        assert.equal(runtime.anchorClicks.at(-1).download, 'rushd-backup-2026-01-02.json');
    } finally {
        CoreDate.getTodayISO = originalGetTodayISO;
    }
    // With the real clock, the filename agrees with the Riyadh civil date.
    let filenameMatches = false;
    for (let attempt = 0; attempt < 3 && !filenameMatches; attempt += 1) {
        const methods = runtime.captured.mixins.find(mixin => mixin.methods?.downloadBackupFile).methods;
        await methods.downloadBackupFile.call({}, '{}');
        filenameMatches = runtime.anchorClicks.at(-1).download === `rushd-backup-${riyadh(new Date())}.json`;
        if (!filenameMatches) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(filenameMatches, true, 'backup filename must follow the local civil day');
}

if (process.env.RUSHD_TZ_CHILD === '1') {
    await runTimezoneAssertions();
    console.log('Rushd P01 Riyadh-boundary date regressions passed.');
    process.exit(0);
}

{
    const child = spawnSync(process.execPath, [thisFile], {
        env: { ...process.env, RUSHD_TZ_CHILD: '1', TZ: 'Asia/Riyadh' },
        encoding: 'utf8'
    });
    assert.equal(child.status, 0, `Riyadh-boundary child failed:\n${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /Riyadh-boundary date regressions passed/);
}

// P1-03: changing today's allowance must not rewrite an older period's budget.
{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    const store = runtime.Store;
    const currentMonthKey = store.currentDate.slice(0, 7);
    const [year, month] = store.currentDate.split('-').map(Number);
    const previousMonthKey = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;

    // init recorded the live month automatically.
    const history = await runtime.DB.getSetting('monthlyBaseAllowances', {});
    assert.equal(history[currentMonthKey], 1000);

    await runtime.DB.setSetting('monthlyBaseAllowances', { [previousMonthKey]: 2400 });
    store.settings.monthlyBaseAllowances = { [previousMonthKey]: 2400 };

    store.settings.baseAllowance = 3000;
    assert.equal(store.getBudgetForMonth(previousMonthKey), 2400);
    assert.equal(store.getBudgetForMonth(currentMonthKey), 3000);

    // The month-end settlement summary claims the recorded budget, not today's.
    const snapshot = await store.getMonthFinancialSnapshot(previousMonthKey);
    assert.equal(snapshot.budget, 2400);

    // An explicit new allowance records only the live month.
    store.settings.baseAllowance = 3200;
    await store.recordCurrentMonthBaseAllowance();
    assert.equal(store.getBudgetForMonth(previousMonthKey), 2400);
    assert.equal(store.getBudgetForMonth(currentMonthKey), 3200);
    const persisted = await runtime.DB.getSetting('monthlyBaseAllowances', {});
    assert.equal(persisted[previousMonthKey], 2400);
    assert.equal(persisted[currentMonthKey], 3200);

    // Review fix P1-03: an older month without a snapshot has an unknown
    // budget. Today's allowance must never become its displayed or settled
    // historical fact.
    store.settings.monthlyBaseAllowances = {};
    store.settings.baseAllowance = 9999;
    assert.equal(store.getBudgetForMonth(previousMonthKey), null);
    const unknownSnapshot = await store.getMonthFinancialSnapshot(previousMonthKey);
    assert.equal(unknownSnapshot.budgetKnown, false);
    assert.equal(unknownSnapshot.budget, null);
    assert.equal(unknownSnapshot.surplus, null);

    const pastDate = `${previousMonthKey}-15`;
    await store.refreshStatistics(pastDate);
    assert.equal(store.statistics.budgetKnown, false);
    assert.equal(store.statistics.budget, null);
    assert.equal(store.statistics.safeToSpend, null);
    assert.equal(store.safeToSpend, null);

    // The month-end settlement calculation is blocked for that month.
    const controllerMethods = runtime.captured.mixins.find(mixin => mixin.methods?.buildMonthEndDecisionSummary).methods;
    const blockedSummary = await controllerMethods.buildMonthEndDecisionSummary.call(
        { store, core: runtime.context.MicroSaveCore },
        `${currentMonthKey}-05`
    );
    assert.equal(blockedSummary, null);

    // A trustworthy snapshot restores the full display and settlement path.
    store.settings.monthlyBaseAllowances = { [previousMonthKey]: 2400 };
    assert.equal(store.getBudgetForMonth(previousMonthKey), 2400);
    await store.refreshStatistics(pastDate);
    assert.equal(store.statistics.budgetKnown, true);
    assert.equal(store.statistics.budget, 2400);
    assert.equal(store.safeToSpend, 2400);
    const knownSummary = await controllerMethods.buildMonthEndDecisionSummary.call(
        { store, core: runtime.context.MicroSaveCore },
        `${currentMonthKey}-05`
    );
    assert.equal(knownSummary.previousMonthBudget, 2400);
    // Completed settlement records still resolve without recomputation.
    await runtime.DB.setSetting('monthEndSettlements', [{
        previousMonthKey, decision: 'vault', targetMonthKey: currentMonthKey,
        surplus: 100, previousMonthBudget: 2400, previousMonthSpent: 2300,
        referenceDate: `${currentMonthKey}-01`
    }]);
    store.settings.monthEndSettlements = await runtime.DB.getSetting('monthEndSettlements', []);
    assert.equal(store.getMonthEndSettlement(previousMonthKey)?.decision, 'vault');
}

// P1-05: the fake "divide by four" weekly pace is gone.
{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.DB.setSetting('safeToSpendMode', 'weekly');
    await runtime.Store.init();
    assert.equal(runtime.Store.settings.safeToSpendMode, 'monthly');
    assert.equal(await runtime.DB.getSetting('safeToSpendMode', ''), 'monthly');

    runtime.Store.statistics.safeToSpend = 900;
    const computed = runtime.captured.mixins
        .find(mixin => mixin.computed?.displaySafeToSpend)
        .computed;
    assert.equal(computed.displaySafeToSpend.call({ store: runtime.Store }), 900);

    for (const lang of ['ar', 'en']) {
        assert.equal(runtime.TRANSLATIONS[lang].weeklyDivides, undefined);
        assert.equal(runtime.TRANSLATIONS[lang].safeToSpendView, undefined);
        assert.equal(runtime.TRANSLATIONS[lang].weekly, undefined);
    }
    assert.doesNotMatch(await readSource(), /monthly \/ 4/);
}

// P1-06: a monthly template cannot save without an explicit valid day.
{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    const store = runtime.Store;
    const methods = runtime.captured.mixins.find(mixin => mixin.methods?.submitNewExpense).methods;
    const toasts = [];
    const makeController = (monthDay, name = 'FAKE Monthly Rent') => ({
        store,
        core: runtime.context.MicroSaveCore,
        t: { monthlyDayRequired: 'choose a day', invalidMoneyInput: 'invalid money' },
        showToast: (message) => toasts.push(message),
        addModal: {
            open: true,
            isSubmitting: false,
            mode: 'template',
            form: { name, cost: '500', category: 'home', recurrence: 'monthly', monthDay, applicability: 'everyday' }
        }
    });

    const missingDay = makeController('');
    await methods.submitNewExpense.call(missingDay);
    assert.equal(toasts.at(-1), 'choose a day');
    assert.equal(missingDay.addModal.open, true);
    assert.equal((await runtime.DB.getTemplates()).some(template => template.name === 'FAKE Monthly Rent'), false);

    const invalidDay = makeController('32', 'FAKE Second Monthly');
    await methods.submitNewExpense.call(invalidDay);
    assert.equal(toasts.at(-1), 'choose a day');
    assert.equal((await runtime.DB.getTemplates()).some(template => template.name === 'FAKE Second Monthly'), false);

    const validDay = makeController('7');
    await methods.submitNewExpense.call(validDay);
    assert.equal(validDay.addModal.open, false);
    const saved = (await runtime.DB.getTemplates()).find(template => template.name === 'FAKE Monthly Rent');
    assert.deepEqual(saved.days, [7]);

    // Production occurrence path: the plan creates the template on its day.
    const monthKey = store.currentDate.slice(0, 7);
    const plan = await store.buildTemplateApplyPlan(`${monthKey}-01`);
    assert.ok(plan.toCreate.some(expense => expense.date === `${monthKey}-07` && expense.name === 'FAKE Monthly Rent'));

    // Import gate: day-less monthly templates cannot re-enter via backup.
    const base = { version: '3.1', settings: {}, expenses: [] };
    assert.equal(runtime.validateBackupPayload({
        ...base,
        templates: [{ id: 'm1', name: 'FAKE no-day monthly', recurrence: 'monthly', days: [] }]
    }).ok, false);
    assert.equal(runtime.validateBackupPayload({
        ...base,
        templates: [{ id: 'm2', name: 'FAKE day monthly', recurrence: 'monthly', days: [7] }]
    }).ok, true);
}

// P1-06 review fix: a legacy IndexedDB monthly template without a schedule
// day stays stored untouched (no invented day), but visibly blocks plan
// generation, plan application, Auto-Fill, and onboarding until repaired.
{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    const store = runtime.Store;
    const today = store.currentDate;
    const monthKey = today.slice(0, 7);
    const activeProfileId = store.settings.activeTemplateProfileId;

    // Seed a legacy record through the production storage layer: a monthly
    // template with no days at all, scoped to the active profile.
    await runtime.DB.saveTemplate({
        id: 'legacy-monthly', name: 'FAKE Legacy Rent', expectedCost: 400, category: 'home',
        recurrence: 'monthly', applicability: 'everyday', source: 'template', profileId: activeProfileId
    });
    // A valid daily template so the Auto-Fill contrast below is meaningful.
    await runtime.DB.saveTemplate({
        id: 'daily-ok', name: 'FAKE Daily Bus', expectedCost: 8, category: 'transport',
        recurrence: 'daily', applicability: 'everyday', source: 'template', profileId: activeProfileId
    });
    store.templates = await runtime.DB.getTemplates();

    // 1. The legacy record keeps its empty schedule — no day was invented.
    const stored = (await runtime.DB.getTemplates()).find(template => template.id === 'legacy-monthly');
    assert.ok(!Array.isArray(stored.days) || stored.days.length === 0);
    assert.deepEqual(store.getInvalidMonthlyScheduleTemplates(activeProfileId).map(template => template.id), ['legacy-monthly']);

    // 2. Plan generation refuses atomically: flagged plan, zero mutations.
    const blockedPlan = await store.buildTemplateApplyPlan(`${monthKey}-01`);
    assert.equal(blockedPlan.blocked, true);
    assert.equal(blockedPlan.blockedReason, 'monthlyDayMissing');
    assert.deepEqual(blockedPlan.blockedTemplates.map(template => template.id), ['legacy-monthly']);
    assert.equal(blockedPlan.toCreate.length, 0);
    assert.equal(blockedPlan.toUpdate.length, 0);
    assert.equal(blockedPlan.toDelete.length, 0);
    assert.equal(blockedPlan.summary.totalChanges, 0);

    // 3. Plan application writes nothing at all — no expense writes and no
    // monthly assignment write — while the legacy template is unresolved.
    let writePlanCalls = 0;
    const originalWritePlan = runtime.DB.applyExpenseWritePlan;
    runtime.DB.applyExpenseWritePlan = async (...args) => {
        writePlanCalls += 1;
        return originalWritePlan.apply(runtime.DB, args);
    };
    const assignmentsBefore = JSON.stringify(store.settings.monthlyTemplateAssignments);
    const refused = await store.applyTemplatesFrom(`${monthKey}-01`);
    assert.equal(refused.blocked, true);
    assert.equal(writePlanCalls, 0);
    assert.equal(JSON.stringify(store.settings.monthlyTemplateAssignments), assignmentsBefore);

    // 4. Auto-Fill blocks and creates nothing even though a valid daily
    // template would normally generate today.
    assert.equal(await store.autoFillDay(today), 0);
    assert.equal((await runtime.DB.getExpensesByDate(today)).length, 0);

    // Controller layer: Auto-Fill shows the bilingual explanation naming the
    // template instead of silently doing nothing.
    const autoToasts = [];
    const autoMethods = runtime.captured.mixins.find(mixin => mixin.methods?.autoFillToday).methods;
    await autoMethods.autoFillToday.call({
        store,
        core: runtime.context.MicroSaveCore,
        t: { historicalAutoFillBlocked: 'historical blocked', autoFillBlockedMonthlyDay: 'blocked: {name}' },
        showToast: (message) => autoToasts.push(message)
    });
    assert.equal(autoToasts.at(-1), 'blocked: FAKE Legacy Rent');
    assert.equal((await runtime.DB.getExpensesByDate(today)).length, 0);

    // 5. Editing without selecting a day is refused and changes nothing.
    const editToasts = [];
    const editMethods = runtime.captured.mixins.find(mixin => mixin.methods?.saveEditedExpense).methods;
    const makeEditController = (monthDay) => ({
        store,
        core: runtime.context.MicroSaveCore,
        t: { monthlyDayRequired: 'choose a day', invalidMoneyInput: 'invalid money', templateSaveFailed: 'save failed ' },
        showToast: (message) => editToasts.push(message),
        alert: () => {},
        editModal: {
            open: true,
            type: 'template',
            item: stored,
            form: { name: 'FAKE Legacy Rent', cost: '400', category: 'home', recurrence: 'monthly', applicability: 'everyday', monthDay, profileId: activeProfileId }
        }
    });
    await editMethods.saveEditedExpense.call(makeEditController(''));
    assert.equal(editToasts.at(-1), 'choose a day');
    assert.equal(editToasts.at(-1), 'choose a day'); // guard against silent early returns
    const stillBroken = (await runtime.DB.getTemplates()).find(template => template.id === 'legacy-monthly');
    assert.ok(!Array.isArray(stillBroken.days) || stillBroken.days.length === 0);

    await editMethods.saveEditedExpense.call(makeEditController('0'));
    assert.equal(editToasts.at(-1), 'choose a day');

    // 6. Repairing with a valid day unblocks every path.
    const repairedController = makeEditController('15');
    await editMethods.saveEditedExpense.call(repairedController);
    assert.equal(repairedController.editModal.open, false);
    const repaired = (await runtime.DB.getTemplates()).find(template => template.id === 'legacy-monthly');
    assert.deepEqual(repaired.days, [15]);
    assert.equal(store.getInvalidMonthlyScheduleTemplates(activeProfileId).length, 0);

    const unblockedPlan = await store.buildTemplateApplyPlan(`${monthKey}-01`);
    assert.equal(unblockedPlan.blocked, undefined);
    assert.ok(unblockedPlan.toCreate.some(expense => expense.date === `${monthKey}-15` && expense.name === 'FAKE Legacy Rent'));
    assert.ok(unblockedPlan.toCreate.some(expense => expense.date === today && expense.name === 'FAKE Daily Bus'));

    // With the schedule repaired, Auto-Fill works again and generates the
    // valid daily template for today.
    assert.equal(await store.autoFillDay(today), 1);

    const appliedPlan = await store.applyTemplatesFrom(`${monthKey}-01`);
    assert.equal(appliedPlan.blocked, undefined);
    assert.equal(writePlanCalls, 1);
    runtime.DB.applyExpenseWritePlan = originalWritePlan;
    assert.equal(store.getMonthlyTemplateAssignment(monthKey)?.assignedProfileId, activeProfileId);
}

// P1-06 review fix: direct production storage paths cannot create new
// dayless monthly templates, and onboarding blocks before any write.
{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    const store = runtime.Store;
    const activeProfileId = store.settings.activeTemplateProfileId;
    const methods = runtime.captured.mixins.find(mixin => mixin.methods?.submitNewExpense).methods;
    const toasts = [];

    // Add-template path without a day creates no template record.
    await methods.submitNewExpense.call({
        store,
        core: runtime.context.MicroSaveCore,
        t: { monthlyDayRequired: 'choose a day', invalidMoneyInput: 'invalid money' },
        showToast: (message) => toasts.push(message),
        addModal: {
            open: true, isSubmitting: false, mode: 'template',
            form: { name: 'FAKE Dayless', cost: '10', category: 'food', recurrence: 'monthly', monthDay: '', applicability: 'everyday' }
        }
    });
    assert.equal(toasts.at(-1), 'choose a day');
    assert.equal((await runtime.DB.getTemplates()).some(template => template.name === 'FAKE Dayless'), false);

    // Onboarding: adding a monthly item without a day is refused.
    const onboardingMethods = runtime.captured.mixins.find(mixin => mixin.methods?.addOnboardingTemplateItem).methods;
    const onboardingToasts = [];
    const onboarding = {
        t: { monthlyDayRequired: 'choose a day', invalidMoneyInput: 'invalid money' },
        showToast: (message) => onboardingToasts.push(message),
        core: runtime.context.MicroSaveCore,
        onboardingModal: {
            monthlyItems: [],
            monthlyDraft: { name: 'FAKE Setup Rent', cost: '300', category: 'home', day: '' }
        }
    };
    onboardingMethods.addOnboardingTemplateItem.call(onboarding, 'monthly');
    assert.equal(onboardingToasts.at(-1), 'choose a day');
    assert.equal(onboarding.onboardingModal.monthlyItems.length, 0);
    onboarding.onboardingModal.monthlyDraft.day = '22';
    onboardingMethods.addOnboardingTemplateItem.call(onboarding, 'monthly');
    assert.deepEqual([...onboarding.onboardingModal.monthlyItems[0].days], [22]);

    // Onboarding finish: a legacy dayless monthly item in the staged plan
    // blocks setup before any profile, settings, or plan write.
    let resolvedProfile = false;
    const finishToasts = [];
    const finishMethods = runtime.captured.mixins.find(mixin => mixin.methods?.finishOnboarding).methods;
    await finishMethods.finishOnboarding.call({
        onboardingCanFinish: true,
        store,
        core: runtime.context.MicroSaveCore,
        t: { onboardingBlockedMonthlyDay: 'setup blocked: {name}', invalidMoneyInput: 'invalid money' },
        showToast: (message) => finishToasts.push(message),
        onboardingModal: {
            open: true, isLoading: false, budget: '1000', effectiveDate: store.currentDate,
            planMode: 'existing', monthlyItems: [{ id: 'legacy-monthly', name: 'FAKE Legacy Rent', recurrence: 'monthly', days: [] }]
        },
        resolveOnboardingTargetProfileId: async () => { resolvedProfile = true; return activeProfileId; }
    });
    assert.equal(finishToasts.at(-1), 'setup blocked: FAKE Legacy Rent');
    assert.equal(resolvedProfile, false);
}

// P1-07: an assignment applies only from its effective date forward.
{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    const store = runtime.Store;
    const monthKey = store.currentDate.slice(0, 7);
    const effectiveDate = `${monthKey}-20`;
    const beforeDate = `${monthKey}-10`;

    await runtime.DB.saveTemplate({
        id: 'temp-p2', name: 'FAKE P2 Item', expectedCost: 10, category: 'food',
        recurrence: 'daily', applicability: 'everyday', profileId: 'p2'
    });
    store.templates = await runtime.DB.getTemplates();

    const plan = await store.applyTemplatesFrom(effectiveDate, { profileId: 'p2' });
    assert.equal(plan.rangeStart, effectiveDate);
    assert.ok(!plan.toCreate.some(expense => expense.date < effectiveDate));
    assert.equal(store.getMonthlyTemplateAssignment(store.currentDate)?.assignedProfileId, 'p2');

    assert.equal(store.resolveTemplateProfileIdForDate(effectiveDate), 'p2');
    assert.equal(store.resolveTemplateProfileIdForDate(`${monthKey}-25`), 'p2');
    // Before the effective date the assignment does not govern the day.
    assert.equal(store.resolveTemplateProfileIdForDate(beforeDate), store.settings.activeTemplateProfileId);
}

// P1-07 review fix: historical Auto-Fill cannot regenerate activity from
// today's mutable profile/template rules.
{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    const store = runtime.Store;
    const today = store.currentDate;
    const [year, month] = today.split('-').map(Number);
    const pastDate = month === 1 ? `${year - 1}-12-20` : `${year}-${String(month - 1).padStart(2, '0')}-20`;

    // A paid historical fact that must never be touched.
    await runtime.DB.saveExpense({
        id: 'historical-paid', name: 'FAKE historical paid', expectedCost: 50, actualPaid: 45,
        isPaid: true, category: 'food', classification: 'essential', source: 'manual', date: pastDate
    });

    await runtime.DB.saveTemplate({
        id: 'temp-daily', name: 'FAKE Daily Item', expectedCost: 10, category: 'food',
        recurrence: 'daily', applicability: 'everyday', profileId: 'legacy'
    });
    store.templates = await runtime.DB.getTemplates();

    // Production path refuses to generate for the past date.
    assert.equal(await store.autoFillDay(pastDate), 0);
    let pastExpenses = await runtime.DB.getExpensesByDate(pastDate);
    assert.deepEqual(pastExpenses.map(expense => expense.id), ['historical-paid']);

    // The UI path visibly explains the block instead of failing silently.
    const controllerMethods = runtime.captured.mixins.find(mixin => mixin.methods?.autoFillToday).methods;
    const toasts = [];
    store.currentDate = pastDate;
    await controllerMethods.autoFillToday.call({
        store,
        core: runtime.context.MicroSaveCore,
        t: { historicalAutoFillBlocked: 'auto-fill blocked for past dates' },
        showToast: (message) => toasts.push(message),
        triggerConfetti() { }
    });
    assert.equal(toasts.at(-1), 'auto-fill blocked for past dates');
    pastExpenses = await runtime.DB.getExpensesByDate(pastDate);
    assert.deepEqual(pastExpenses.map(expense => expense.id), ['historical-paid']);

    // Later template edits still cannot create or change historical activity.
    await runtime.DB.saveTemplate({
        id: 'temp-daily', name: 'FAKE Daily Item EDITED', expectedCost: 99, category: 'food',
        recurrence: 'daily', applicability: 'everyday', profileId: 'legacy'
    });
    store.templates = await runtime.DB.getTemplates();
    assert.equal(await store.autoFillDay(pastDate), 0);
    pastExpenses = await runtime.DB.getExpensesByDate(pastDate);
    assert.deepEqual(pastExpenses.map(expense => expense.id), ['historical-paid']);
    assert.equal(pastExpenses[0].isPaid, true);
    assert.equal(pastExpenses[0].actualPaid, 45);

    // Current dates keep working with the active rules.
    store.currentDate = today;
    const createdToday = await store.autoFillDay(today);
    assert.equal(createdToday, 1);
    const todayExpenses = await runtime.DB.getExpensesByDate(today);
    assert.equal(todayExpenses.some(expense => expense.name === 'FAKE Daily Item EDITED' && expense.date === today), true);
}

// P1-08: one generation guards the whole day-load + derived pipeline.
{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    const store = runtime.Store;
    const today = store.currentDate;
    const [year, month] = today.split('-').map(Number);
    const staleDate = month === 1 ? `${year - 1}-12-15` : `${year}-${String(month - 1).padStart(2, '0')}-15`;

    await runtime.DB.saveExpense({
        id: 'stale-a', name: 'FAKE stale A', expectedCost: 100, actualPaid: 100,
        isPaid: true, category: 'food', classification: 'essential', source: 'manual', date: staleDate
    });

    // Deterministic delayed promise for date A's expense fetch.
    const originalGetByDate = runtime.DB.getExpensesByDate.bind(runtime.DB);
    let releaseA;
    const gateA = new Promise(resolve => { releaseA = resolve; });
    runtime.DB.getExpensesByDate = async (dateStr) => {
        const result = await originalGetByDate(dateStr);
        if (dateStr === staleDate) await gateA;
        return result;
    };

    const staleLoad = store.loadDay(staleDate);
    await store.loadDay(today);

    const currentMonthKey = today.slice(0, 7);
    assert.deepEqual(store.currentViewExpenses.map(expense => expense.id), []);
    assert.equal(store.statistics.monthKey, currentMonthKey);
    assert.equal(store.flexibleStats.monthKey, currentMonthKey);

    releaseA();
    await staleLoad;
    await waitTick();

    // The late response for the old date must not publish anything.
    assert.deepEqual(store.currentViewExpenses.map(expense => expense.id), []);
    assert.equal(store.statistics.monthKey, currentMonthKey);
    assert.equal(store.flexibleStats.monthKey, currentMonthKey);
}

// P1-11/P1-12: mock analytics and the harmful reward basis are removed.
{
    const runtime = await loadRushdRuntime();
    const source = await readSource();

    assert.doesNotMatch(source, /GameStore/);
    assert.doesNotMatch(source, /SAR Saved = 10 XP/);
    assert.doesNotMatch(source, /\[5, 12, 8, 15, 10, 20,/);
    assert.doesNotMatch(source, /\[10, 15, 8, 12, 20, 18, 25,/);
    assert.doesNotMatch(source, /game\.level/);

    for (const mixin of runtime.captured.mixins) {
        assert.equal(mixin.watch?.['store.globalStats.netVariance'], undefined,
            'no mixin may wire netVariance into rewards');
        if (typeof mixin.data === 'function') {
            assert.equal('game' in mixin.data.call({}), false, 'no mixin may expose a game store');
        }
    }

    const overlay = runtime.captured.components.find(component => component.name === 'ms-profile-overlay');
    assert.ok(overlay, 'profile overlay must exist');
    assert.match(overlay.definition.template, /momentumPlaceholder/);
    assert.doesNotMatch(overlay.definition.template, /game\.|ms-trend-chart|totalXP/);

    assert.match(runtime.TRANSLATIONS.ar.momentumPlaceholder, /الإنفاق|الثروة/);
    assert.match(runtime.TRANSLATIONS.en.momentumPlaceholder, /spending/);
    assert.equal(runtime.TRANSLATIONS.ar.totalXP, undefined);
    assert.equal(runtime.TRANSLATIONS.en.totalXP, undefined);
}

// Reset/export backup truth: the wording matches what the snapshot restores.
{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    const methods = runtime.captured.mixins.find(mixin => mixin.methods?.buildBackupSnapshot).methods;
    const backup = JSON.parse(await methods.buildBackupSnapshot.call({ store: runtime.Store }));

    assert.deepEqual(Object.keys(backup).sort(), ['expenses', 'exportedAt', 'settings', 'templates', 'version']);
    // exportedAt stays a real UTC timestamp even though the filename is local.
    assert.match(backup.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.equal(backup.exportedAt.endsWith('Z'), true);
    // Language and onboarding preferences live outside this snapshot.
    assert.equal(JSON.stringify(backup).includes('onboardingState'), false);
    assert.equal(JSON.stringify(backup).includes('rushd_lang'), false);

    for (const lang of ['ar', 'en']) {
        const message = runtime.TRANSLATIONS[lang].factoryResetMsg;
        assert.doesNotMatch(message, /كاملة|full backup|complete backup/i);
        assert.match(message, lang === 'ar' ? /غير مشمولة/ : /not included/);
    }
}

console.log('Rushd P01 stability regressions passed.');
