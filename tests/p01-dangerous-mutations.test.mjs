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
            factoryResetMsg: 'سيتم تنزيل نسخة احتياطية كاملة تلقائياً قبل الحذف، ثم تُحذف جميع البيانات نهائياً. لا يمكن التراجع.',
            resetFailedTitle: 'تعذّرت إعادة الضبط',
            resetBackupFailed: 'تعذّر إنشاء النسخة الاحتياطية قبل الحذف، لذلك أُلغيت إعادة الضبط ولم تتغير بياناتك. جرّب التصدير يدوياً ثم أعد المحاولة.',
            resetBlockedError: 'تعذّر إكمال إعادة الضبط لأن رُشد مفتوح في تبويب أو نافذة أخرى. أغلقها ثم أعد المحاولة. بياناتك لم تتغير.',
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
    await waitTick();
    await waitTick();
    assert.equal(runtime.anchorClicks.length, 1);
    assert.match(runtime.anchorClicks[0].download, /^rushd-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(dialogs.at(-1)?.title, 'تعذّرت إعادة الضبط');
    assert.equal(dialogs.at(-1)?.message, 'تعذّر إكمال إعادة الضبط لأن رُشد مفتوح في تبويب أو نافذة أخرى. أغلقها ثم أعد المحاولة. بياناتك لم تتغير.');
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

console.log('Rushd P01 dangerous-mutation regressions passed.');
