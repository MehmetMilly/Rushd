import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadRushdRuntime } from './harness/load-rushd-runtime.mjs';

const readFixture = async (name) => JSON.parse(await readFile(`tests/fixtures/v1/${name}.json`, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const waitTick = () => new Promise((resolve) => setTimeout(resolve, 1));

async function seedStores(runtime, fixture) {
    const stores = fixture.indexed_db.stores;
    await runtime.DB.setSettingsEntries(stores.settings.map(({ key, value }) => ({ key, value })));
    for (const template of stores.templates) await runtime.DB.saveTemplate(template);
    for (const expense of stores.expenses) await runtime.DB.saveExpense(expense);
}

async function databaseSnapshot(runtime) {
    return clone(await runtime.shim.inspect('MicroSaveOS_DB'));
}

{
    const fixture = await readFixture('paid-generated');
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await seedStores(runtime, fixture);
    await runtime.Store.init();

    const plan = await runtime.Store.buildTemplateApplyPlan('2026-08-10');
    assert.equal(plan.toDelete.length, 0);
    assert.equal(plan.toUpdate.length, 0);
    assert.ok(!plan.toCreate.some((expense) => expense.date === '2026-08-10'));

    const expenses = await runtime.DB.getAllExpenses();
    assert.equal(expenses.length, 1);
    assert.equal(expenses[0].id, 'fake-paid-generated');
    assert.equal(expenses[0].isPaid, true);
    assert.equal(expenses[0].actualPaid, 38);
}

{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    const originalExpense = {
        id: 'existing-expense',
        name: 'FAKE Existing',
        expectedCost: 20,
        actualPaid: 18,
        isPaid: true,
        category: 'food',
        classification: 'essential',
        source: 'manual',
        date: '2026-08-25'
    };
    await runtime.DB.saveExpense(originalExpense);
    const before = await databaseSnapshot(runtime);

    runtime.shim.state.failNextWriteTransaction = { reason: 'injected plan failure' };
    await assert.rejects(runtime.DB.applyExpenseWritePlan({
        deletes: [originalExpense.id],
        puts: [{ ...originalExpense, id: 'replacement-expense', isPaid: false }],
        settingsEntries: [{ key: 'baseAllowance', value: 999 }]
    }));
    assert.deepEqual(await databaseSnapshot(runtime), before);

    await runtime.DB.applyExpenseWritePlan({
        deletes: [originalExpense.id],
        puts: [{ ...originalExpense, id: 'replacement-expense', isPaid: false }],
        settingsEntries: [{ key: 'baseAllowance', value: 999 }]
    });
    const after = await databaseSnapshot(runtime);
    assert.equal(after.stores.expenses.some((expense) => expense.id === 'replacement-expense'), true);
    assert.equal(after.stores.expenses.some((expense) => expense.id === originalExpense.id), false);
    assert.equal(after.stores.settings.find((entry) => entry.key === 'baseAllowance').value, 999);
}

{
    const malformed = await readFixture('malformed');
    const populated = await readFixture('populated');
    const legacy = await readFixture('legacy-vault');
    const runtime = await loadRushdRuntime();

    for (const candidate of malformed.malformed_backup_candidates) {
        assert.equal(runtime.validateBackupPayload(candidate.payload).ok, false, candidate.id);
    }
    assert.equal(runtime.validateBackupPayload(populated.backup).ok, true);
    assert.equal(runtime.validateBackupPayload(legacy.backup).ok, true);
}

{
    const populated = await readFixture('populated');
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.DB.saveExpense({
        id: 'preserve-on-failure',
        name: 'FAKE Preserve',
        expectedCost: 5,
        actualPaid: 0,
        isPaid: false,
        category: 'food',
        classification: 'essential',
        source: 'manual',
        date: '2026-08-25'
    });
    const before = await databaseSnapshot(runtime);

    runtime.shim.state.failNextWriteTransaction = { reason: 'injected import failure' };
    await assert.rejects(runtime.DB.restoreBackupRecords({
        settingsEntries: [{ key: 'baseAllowance', value: populated.backup.settings.baseAllowance }],
        templates: populated.backup.templates || [],
        expenses: populated.backup.expenses
    }));
    assert.deepEqual(await databaseSnapshot(runtime), before);

    await runtime.DB.restoreBackupRecords({
        settingsEntries: [{ key: 'baseAllowance', value: populated.backup.settings.baseAllowance }],
        templates: populated.backup.templates || [],
        expenses: populated.backup.expenses
    });
    const after = await databaseSnapshot(runtime);
    assert.equal(after.stores.expenses.some((expense) => expense.id === 'preserve-on-failure'), true);
    assert.equal(after.stores.settings.find((entry) => entry.key === 'baseAllowance').value, populated.backup.settings.baseAllowance);
}

{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    const methods = runtime.captured.mixins.find(mixin => mixin.methods?.saveSettings).methods;
    const toasts = [];
    const controller = {
        store: runtime.Store,
        t: { invalidMoneyInput: 'invalid money' },
        showToast(message) { toasts.push(message); }
    };

    controller.store.settings.baseAllowance = '١٬٢٣٤٫٥٠';
    await methods.saveSettings.call(controller);
    assert.equal(controller.store.settings.baseAllowance, 1234.5);
    assert.equal((await runtime.DB.getSetting('baseAllowance', 0)), 1234.5);
    assert.equal(toasts.length, 0);

    controller.store.settings.baseAllowance = '-5';
    await methods.saveSettings.call(controller);
    assert.equal(controller.store.settings.baseAllowance, '-5');
    assert.equal((await runtime.DB.getSetting('baseAllowance', 0)), 1234.5);
    assert.equal(toasts.at(-1), 'invalid money');
}

{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    await runtime.Store.addExpense({
        id: 'payment-validation',
        name: 'FAKE Payment',
        expectedCost: 20,
        actualPaid: 0,
        isPaid: false,
        category: 'food',
        classification: 'essential',
        source: 'manual',
        date: '2026-08-25'
    });
    const expense = await runtime.DB.getAllExpenses()
        .then(expenses => expenses.find(item => item.id === 'payment-validation'));
    const methods = runtime.captured.mixins.find(mixin => mixin.methods?.commitPayment).methods;
    const controller = {
        store: runtime.Store,
        payModal: { amount: '-1', item: expense },
        t: { invalidMoneyInput: 'invalid payment' },
        showToast(message) { controller.toast = message; },
        triggerConfetti() { controller.confetti = true; }
    };

    await methods.commitPayment.call(controller);
    assert.equal(controller.toast, 'invalid payment');
    assert.equal(expense.isPaid, false);
    assert.equal(expense.actualPaid, 0);

    controller.payModal.amount = '١٢٫٥٠';
    await methods.commitPayment.call(controller);
    assert.equal(expense.isPaid, true);
    assert.equal(expense.actualPaid, 12.5);
    assert.equal(controller.payModal.open, false);
}

{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    runtime.Store.settings.baseAllowance = 1000;
    const vault = { balance: 100, transactions: [], goals: [] };
    runtime.Store.settings.vault = vault;
    runtime.Store.settings.monthEndSettlements = [];
    await runtime.DB.setSettingsEntries([
        { key: 'vault', value: vault },
        { key: 'monthEndSettlements', value: [] }
    ]);
    const summary = {
        previousMonthKey: '2026-07',
        previousMonthBudget: 1000,
        previousMonthSpent: 900,
        surplus: 75
    };

    runtime.shim.state.failNextWriteTransaction = { reason: 'injected settlement failure' };
    const before = await databaseSnapshot(runtime);
    const vaultBefore = clone(runtime.Store.settings.vault);
    const settlementsBefore = clone(runtime.Store.settings.monthEndSettlements);
    await assert.rejects(runtime.Store.settleMonthEndToVault(summary, '2026-08-01'));
    assert.deepEqual(runtime.Store.settings.vault, vaultBefore);
    assert.deepEqual(runtime.Store.settings.monthEndSettlements, settlementsBefore);
    assert.deepEqual(await databaseSnapshot(runtime), before);

    const settled = await runtime.Store.settleMonthEndToVault(summary, '2026-08-01');
    assert.equal(settled.transaction.amount, 75);
    const retried = await runtime.Store.settleMonthEndToVault(summary, '2026-08-01');
    assert.equal(retried.alreadySettled, true);
    const stored = await databaseSnapshot(runtime);
    assert.equal(stored.stores.settings.find((entry) => entry.key === 'monthEndSettlements').value.length, 1);
    assert.equal(stored.stores.settings.find((entry) => entry.key === 'vault').value.transactions.length, 1);
}

{
    const fixture = await readFixture('paid-generated');
    const runtime = await loadRushdRuntime({ localStorage: { rushd_lang: 'ar', unrelated: 'keep' } });
    await runtime.DB.connect();
    await seedStores(runtime, fixture);
    await runtime.Store.init();
    const method = runtime.captured.mixins[0].methods;
    const dialogs = [];
    let confirmCallback;
    const controller = {
        ...method,
        t: {
            factoryResetQ: 'إعادة ضبط المصنع؟',
            factoryResetMsg: 'ستُحذف جميع البيانات المحلية نهائياً ولا يمكن التراجع. لن يتم إنشاء أي نسخة احتياطية تلقائياً؛ إذا كنت تريد نسخة احتياطية، ألغِ واستخدم تصدير نسخة احتياطية أولاً.',
            resetFailedTitle: 'تعذّرت إعادة الضبط',
            resetWaitingTitle: 'إعادة الضبط قيد الانتظار',
            resetWaiting: 'إعادة الضبط تنتظر إغلاق تبويب أو نافذة أخرى لرُشد. سيستمر الحذف تلقائيًا عند إغلاقها؛ لا تغلق هذه الصفحة.',
            resetFailed: 'تعذّر حذف البيانات المحلية ولم يتغير شيء. أعد المحاولة.',
            dialogOk: 'حسنًا'
        },
        store: runtime.Store,
        showConfirmDialog(title, message) {
            dialogs.push({ title, message });
            confirmCallback = arguments[2];
        }
    };

    runtime.shim.state.blockDeleteDatabase = true;
    const reset = method.resetApp.call(controller);
    void confirmCallback();
    await reset;
    for (let index = 0; index < 6; index += 1) await waitTick();
    assert.equal(runtime.anchorClicks.length, 0, 'no-export reset must not trigger any backup download');
    assert.equal(dialogs.at(-1)?.title, 'إعادة الضبط قيد الانتظار');
    assert.equal(dialogs.at(-1)?.message, 'إعادة الضبط تنتظر إغلاق تبويب أو نافذة أخرى لرُشد. سيستمر الحذف تلقائيًا عند إغلاقها؛ لا تغلق هذه الصفحة.');
    assert.equal(runtime.localStorage.getItem('rushd_lang'), 'ar');
    assert.equal(runtime.localStorage.getItem('unrelated'), 'keep');
    assert.equal(runtime.captured.reloads, 0);
    assert.equal((await runtime.DB.getAllExpenses()).length, 1);

    runtime.shim.resolveBlockedDelete();
    await waitTick();
    assert.equal(runtime.captured.reloads, 1);
    assert.equal(runtime.localStorage.getItem('rushd_lang'), null);
    assert.equal(runtime.localStorage.getItem('unrelated'), 'keep');
}

{
    const runtime = await loadRushdRuntime();
    const parse = runtime.RushdMoneyInput.parseMoneyInput;
    assert.equal(parse('12.50'), 12.5);
    assert.equal(parse('١٢٫٥٠'), 12.5);
    assert.equal(parse('١٬٢٣٤٫٥٠'), 1234.5);
    assert.equal(parse('1,234.50'), 1234.5);
    for (const value of ['-1', 'NaN', 'Infinity', '1.234', '1000000000', '1,23', '١٢٣٬٤٥٦٫٧٨٩']) {
        assert.equal(parse(value), null, value);
    }
}

{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    runtime.Store.settings.baseAllowance = 1000;
    await runtime.Store.addExpense({
        id: 'reserved-august',
        name: 'FAKE reserved rent',
        expectedCost: 500,
        actualPaid: 0,
        isPaid: false,
        category: 'home',
        classification: 'essential',
        source: 'manual',
        date: '2026-08-10'
    });
    await runtime.Store.addExpense({
        id: 'paid-august',
        name: 'FAKE paid food',
        expectedCost: 100,
        actualPaid: 100,
        isPaid: true,
        category: 'food',
        classification: 'essential',
        source: 'manual',
        date: '2026-08-10'
    });
    runtime.Store.settings.baseAllowance = 1000;
    // Review fix P1-03: the snapshot for a past month is the only trustworthy
    // budget source; without it the snapshot reports an unknown budget.
    runtime.Store.settings.monthlyBaseAllowances = { '2026-08': 1000 };
    const snapshot = await runtime.Store.getMonthFinancialSnapshot('2026-08');
    assert.equal(snapshot.budgetKnown, true);
    assert.equal(snapshot.unpaidReserved, 500);
    assert.equal(snapshot.surplus, 400);

    runtime.Store.settings.monthlyBaseAllowances = {};
    const unknownBudget = await runtime.Store.getMonthFinancialSnapshot('2026-08');
    assert.equal(unknownBudget.budgetKnown, false);
    assert.equal(unknownBudget.budget, null);
    assert.equal(unknownBudget.surplus, null);
    runtime.Store.settings.monthlyBaseAllowances = { '2026-08': 1000 };
}

{
    const fixture = await readFixture('legacy-vault');
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await seedStores(runtime, fixture);
    await runtime.Store.init();
    assert.equal(runtime.Store.settings.vault.openingBalance, 550);
    assert.equal(runtime.Store.settings.vault.balance, 650);
    const persisted = (await databaseSnapshot(runtime)).stores.settings
        .find(({ key }) => key === 'vault').value;
    assert.equal(persisted.openingBalance, 550);
}

{
    const fixture = await readFixture('populated');
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await seedStores(runtime, fixture);
    await runtime.Store.init();
    runtime.Store.settings.vault.goals[0].allocatedAmount = 60;
    runtime.Store.settings.vault.goals[1].allocatedAmount = 40;
    const getter = runtime.captured.mixins
        .find(mixin => mixin.computed?.vaultGoalsWithProgress)
        .computed.vaultGoalsWithProgress;
    const progress = getter.call({ vaultGoals: runtime.Store.settings.vault.goals });
    assert.deepEqual(progress.map(goal => goal.progressAmount), [60, 40]);
    assert.deepEqual(progress.map(goal => goal.progressPercentage), [5, (40 / 450) * 100]);
}

{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    runtime.Store.currentDate = '2025-01-15';
    await runtime.Store.addExpense({
        id: 'january-expense',
        name: 'FAKE January expense',
        expectedCost: 100,
        actualPaid: 100,
        isPaid: true,
        category: 'food',
        classification: 'essential',
        source: 'manual',
        date: '2025-01-15'
    });
    runtime.Store.settings.baseAllowance = 1000;
    runtime.Store.settings.monthlyBaseAllowances = { '2025-01': 1000 };
    await runtime.Store.refreshStatistics('2025-01-15');
    assert.equal(runtime.Store.statistics.monthKey, '2025-01');
    assert.equal(runtime.Store.statistics.budgetKnown, true);
    assert.equal(runtime.Store.safeToSpend, 900);
}

{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    runtime.Store.settings.baseAllowance = 0;
    runtime.Store.settings.vault = {
        balance: 70,
        openingBalance: 0,
        transactions: [{
            id: 'orphan-transfer',
            type: 'surplus_transfer',
            amount: 70,
            date: '2026-08-01',
            monthKey: '2026-08',
            sourceMonthKey: '2026-07',
            createdAt: '2026-08-01T09:00:00.000Z'
        }],
        goals: []
    };
    runtime.Store.settings.monthEndSettlements = [];
    await runtime.DB.setSettingsEntries([
        { key: 'vault', value: runtime.Store.settings.vault },
        { key: 'monthEndSettlements', value: [] }
    ]);
    const summary = {
        previousMonthKey: '2026-07',
        previousMonthBudget: 100,
        previousMonthSpent: 10,
        surplus: 90
    };
    const recovered = await runtime.Store.settleMonthEndToVault(summary, '2026-08-01');
    assert.equal(recovered.alreadySettled, undefined);
    assert.equal(recovered.transaction.amount, 70);
    assert.equal(recovered.settlement.surplus, 70);
    assert.equal(recovered.settlement.vaultTransactionId, 'orphan-transfer');
}

{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    await runtime.Store.addVaultTransaction({
        id: 'float-residue-transfer',
        amount: 0.1 + 0.2,
        date: '2026-08-01',
        sourceMonthKey: '2026-07',
        createdAt: '2026-08-01T09:00:00.000Z'
    });
    const appMethods = runtime.captured.mixins.find(mixin => mixin.methods?.buildBackupSnapshot).methods;
    const backup = JSON.parse(await appMethods.buildBackupSnapshot.call({ store: runtime.Store }));
    assert.equal(backup.settings.vault.transactions[0].amount, 0.3);
    assert.equal(runtime.validateBackupPayload(backup).ok, true);

    const restoredRuntime = await loadRushdRuntime();
    await restoredRuntime.DB.connect();
    await restoredRuntime.DB.restoreBackupRecords({
        settingsEntries: Object.entries(backup.settings).map(([key, value]) => ({ key, value })),
        templates: backup.templates,
        expenses: backup.expenses
    });
    await restoredRuntime.Store.init();
    assert.equal(restoredRuntime.Store.settings.vault.transactions[0].amount, 0.3);
}

{
    const runtime = await loadRushdRuntime();
    const validBackup = {
        version: '3.1',
        settings: {
            vault: {
                balance: 100,
                transactions: [{ id: 'vault-valid', amount: 10, date: '2026-08-01' }],
                goals: [{ id: 'legacy-goal-allocation-optional', name: 'FAKE legacy goal', targetAmount: 100 }]
            }
        },
        templates: [],
        expenses: []
    };
    assert.equal(runtime.validateBackupPayload(validBackup).ok, true);

    const overAllocated = clone(validBackup);
    overAllocated.settings.vault.goals = [
        { id: 'goal-a', name: 'FAKE A', targetAmount: 100, allocatedAmount: 80 },
        { id: 'goal-b', name: 'FAKE B', targetAmount: 100, allocatedAmount: 30 }
    ];
    assert.equal(runtime.validateBackupPayload(overAllocated).ok, false);

    const inconsistentVaultBalance = clone(validBackup);
    inconsistentVaultBalance.settings.vault.openingBalance = 0;
    inconsistentVaultBalance.settings.vault.goals = [{ id: 'goal-exceeds-normalized-vault', name: 'FAKE balance mismatch', targetAmount: 100, allocatedAmount: 80 }];
    assert.equal(runtime.validateBackupPayload(inconsistentVaultBalance).ok, false);

    const decimalAllocationBalance = clone(validBackup);
    decimalAllocationBalance.settings.vault = {
        balance: 0.3,
        transactions: [],
        goals: [
            { id: 'decimal-goal-a', name: 'FAKE decimal A', targetAmount: 1, allocatedAmount: 0.1 },
            { id: 'decimal-goal-b', name: 'FAKE decimal B', targetAmount: 1, allocatedAmount: 0.2 }
        ]
    };
    assert.equal(runtime.validateBackupPayload(decimalAllocationBalance).ok, true);

    const duplicateGoals = clone(validBackup);
    duplicateGoals.settings.vault.goals = [
        { id: 'duplicate-goal', name: 'FAKE A', targetAmount: 20, allocatedAmount: 10 },
        { id: 'duplicate-goal', name: 'FAKE B', targetAmount: 20, allocatedAmount: 10 }
    ];
    assert.equal(runtime.validateBackupPayload(duplicateGoals).ok, false);

    const discardedVaultTransaction = clone(validBackup);
    discardedVaultTransaction.settings.vault.transactions[0].amount = 0;
    assert.equal(runtime.validateBackupPayload(discardedVaultTransaction).ok, false);

    for (const [field, value] of [
        ['type', 'manual_transfer'],
        ['monthKey', 'not-a-month'],
        ['sourceMonthKey', 'not-a-month'],
        ['createdAt', 'not-a-timestamp']
    ]) {
        const invalidTransactionMetadata = clone(validBackup);
        invalidTransactionMetadata.settings.vault.transactions[0][field] = value;
        assert.equal(runtime.validateBackupPayload(invalidTransactionMetadata).ok, false, field);
    }

    const impossibleDates = clone(validBackup);
    impossibleDates.expenses = [{ id: 'impossible-date', date: '2026-02-30', expectedCost: 10, actualPaid: 0 }];
    assert.equal(runtime.validateBackupPayload(impossibleDates).ok, false);

    const duplicateExpenses = clone(validBackup);
    duplicateExpenses.expenses = [
        { id: 'duplicate-expense', date: '2026-08-01', expectedCost: 10, actualPaid: 0 },
        { id: 'duplicate-expense', date: '2026-08-02', expectedCost: 10, actualPaid: 0 }
    ];
    assert.equal(runtime.validateBackupPayload(duplicateExpenses).ok, false);
}

{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.Store.init();
    const vault = { balance: 0, openingBalance: 0, transactions: [], goals: [] };
    await runtime.DB.setSettingsEntries([
        { key: 'vault', value: vault },
        { key: 'monthEndSettlements', value: [] }
    ]);
    runtime.Store.settings.vault = vault;
    runtime.Store.settings.monthEndSettlements = [];
    const summary = {
        previousMonthKey: '2026-07',
        previousMonthBudget: 100,
        previousMonthSpent: 20,
        surplus: 80
    };

    const budget = await runtime.Store.settleMonthEndToBudget(summary, '2026-08-01');
    const originalSettlement = clone(budget.settlement);
    const repeatedBudget = await runtime.Store.settleMonthEndToBudget({ ...summary, surplus: 1 }, '2026-08-02');
    assert.equal(repeatedBudget.alreadySettled, true);
    assert.equal(JSON.stringify(repeatedBudget.settlement), JSON.stringify(originalSettlement));
    const conflictingVault = await runtime.Store.settleMonthEndToVault(summary, '2026-08-02');
    assert.equal(conflictingVault.alreadySettled, true);
    assert.equal(conflictingVault.settlement.decision, 'budget');
    assert.equal(runtime.Store.settings.vault.transactions.length, 0);

    const noSurplusSummary = { previousMonthKey: '2026-06', previousMonthBudget: 100, previousMonthSpent: 100, surplus: 0 };
    const noSurplus = await runtime.Store.settleMonthEndNoSurplus(noSurplusSummary, '2026-07-01');
    const repeatedNoSurplus = await runtime.Store.settleMonthEndNoSurplus(noSurplusSummary, '2026-07-02');
    assert.equal(repeatedNoSurplus.alreadySettled, true);
    assert.equal(JSON.stringify(repeatedNoSurplus.settlement), JSON.stringify(noSurplus.settlement));

    const concurrentSummary = { previousMonthKey: '2026-05', previousMonthBudget: 100, previousMonthSpent: 10, surplus: 90 };
    const [vaultAttempt, budgetAttempt] = await Promise.all([
        runtime.Store.settleMonthEndToVault(concurrentSummary, '2026-06-01'),
        runtime.Store.settleMonthEndToBudget(concurrentSummary, '2026-06-01')
    ]);
    assert.equal(vaultAttempt.settlement.decision, 'vault');
    assert.equal(budgetAttempt.alreadySettled, true);
    assert.equal(budgetAttempt.settlement.decision, 'vault');
    assert.equal(runtime.Store.settings.vault.transactions.filter(transaction => transaction.sourceMonthKey === '2026-05').length, 1);
}

{
    const runtime = await loadRushdRuntime();
    await runtime.DB.connect();
    await runtime.DB.saveExpense({ id: 'indexed-august-first', date: '2026-08-01', expectedCost: 10, actualPaid: 0 });
    await runtime.DB.saveExpense({ id: 'indexed-august-second', date: '2026-08-02', expectedCost: 10, actualPaid: 0 });
    const indexedExpenses = await runtime.DB.getExpensesByDate('2026-08-01');
    assert.deepEqual(indexedExpenses.map(expense => expense.id), ['indexed-august-first']);
}

console.log('Rushd P01 dangerous-mutation regressions passed.');
