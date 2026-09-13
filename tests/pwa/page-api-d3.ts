/**
 * Same-origin page API for P04-D3 browser tests.
 *
 * Mounts the REAL established shell (root template + root controller +
 * legacy components) in explicit candidate mode through
 * `prepareCandidateShell`, then drives it exactly like the UI does:
 * controller methods behind the DOM buttons, with DOM assertions on the
 * mounted template. All data is synthetic; no account or cloud client is
 * constructed.
 */
/* eslint-env browser */

import * as Vue from 'vue';
import { prepareCandidateShell } from '../../src/application/p04-d/candidate-shell.js';
import { createTabCoordinator } from '../../src/application/p04-d/tab-coordination.js';
import { activateCandidateUpdate } from '../../src/pwa/registration.js';
import { snapshotFromStores } from '../../src/data/migration/extract';
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { createCandidateIdFactory } from '../../src/application/p04-d/candidate-shell.js';

const WORKER_URL = '/harness/v2-worker.js';
const SQLITE_BASE = '/pkg';

interface ShellHandle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shell: Awaited<ReturnType<typeof prepareCandidateShell>> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mounted: any;
  deviceId: string;
  tabId: string;
  inputFingerprint: string | null;
}

let handle: ShellHandle | null = null;

function fakeV1Snapshot() {
  return snapshotFromStores({
    settings: [
      { key: 'baseAllowance', value: 1500 },
      { key: 'theme', value: 'dark' },
    ],
    templates: [],
    expenses: [
      {
        id: 'v1-bread',
        name: 'bread',
        expectedCost: 12,
        actualPaid: 12,
        isPaid: true,
        date: '2026-09-05',
        category: 'food',
        classification: 'essential',
      },
      {
        id: 'v1-scarf',
        name: 'silk scarf',
        expectedCost: 300,
        actualPaid: 300,
        isPaid: true,
        date: '2026-09-05',
        category: 'shopping',
        classification: 'luxury',
      },
      {
        id: 'v1-bus',
        name: 'bus',
        expectedCost: 7,
        actualPaid: 0,
        isPaid: false,
        date: '2026-09-06',
        category: 'transport',
        classification: 'essential',
      },
    ],
    sourcePresent: true,
  });
}

function requireHandle(): ShellHandle {
  if (handle === null || handle.shell === null || handle.mounted === null) {
    throw new Error('candidate shell is not open');
  }
  return handle as ShellHandle & { shell: NonNullable<ShellHandle['shell']> };
}

function cardCount(): number {
  return document.querySelectorAll('.expense-card').length;
}

function domDebug() {
  const app = document.querySelector('#app');
  const html = app ? app.innerHTML : '';
  return {
    htmlLen: html.length,
    hasEmptyState: html.includes('calendar_today'),
    hasSummaryRow: !!document.querySelector('.daily-summary-row'),
    hasHero: !!document.querySelector('.home-hero-amount'),
    expenseListHeadings: document.querySelectorAll('.home-list-heading').length,
  };
}

function summarize() {
  const current = requireHandle();
  const ports = current.shell!.featurePorts;
  return {
    ok: current.shell!.host.ok,
    reason: current.shell!.host.reason,
    authority: ports.authority.getState(),
    storageId: current.shell!.host.storageId,
    selectedDate: ports.home.getSelectedDate(),
    dayCount: ports.home.listSelectedDayExpenses().length,
    domCards: cardCount(),
    ...domDebug(),
    storeCards: current.mounted.store.currentViewExpenses.length,
    storeDate: current.mounted.store.currentDate,
    currentView: current.mounted.currentView,
    safeToSpend: ports.home.getSafeToSpend(),
    heroUnknown: !!document.querySelector('.home-hero-unknown-btn'),
    inputIntact: current.inputFingerprint === null
      ? null
      : current.inputFingerprint === JSON.stringify(fakeV1Snapshot()),
  };
}

export const __p04d3 = {
  async openShell(options: { deviceId: string; migrationId?: string; withSnapshot?: boolean; tabId?: string }) {
    const templateResponse = await fetch('/app/root-template.html');
    if (!templateResponse.ok) throw new Error(`template fetch failed: ${templateResponse.status}`);
    const template = await templateResponse.text();
    const { context: deterministic } = createDeterministicContext({ deviceId: options.deviceId });
    // Reload-unique identities over a deterministic clock/origin, mirroring
    // the production candidate requirement.
    const context = { ...deterministic, ids: createCandidateIdFactory() };
    const coordination = createTabCoordinator({ tabId: options.tabId ?? `d3-tab-${options.deviceId}` });
    const snapshot = options.withSnapshot === false ? undefined : fakeV1Snapshot();
    const shell = await prepareCandidateShell({
      Vue: Vue as never,
      environment: globalThis as typeof globalThis,
      template,
      context,
      snapshot,
      migrationId: options.migrationId ?? `mg-${options.deviceId}-d3-0001`,
      coordination,
      workerUrl: WORKER_URL,
      sqliteAssetBase: SQLITE_BASE,
      selectedDate: '2026-09-05',
    });
    const mounted = (shell.app as { mount(selector: string): unknown }).mount('#app');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (mounted as any).$nextTick();
    // Let the candidate initApp sync settle (one macrotask is enough; the
    // sync itself is awaited inside initApp).
    await new Promise((resolve) => setTimeout(resolve, 250));
    handle = {
      shell, mounted, deviceId: options.deviceId,
      tabId: options.tabId ?? `d3-tab-${options.deviceId}`,
      inputFingerprint: snapshot ? JSON.stringify(snapshot) : null,
    };
    return summarize();
  },

  async reopen() {
    const current = requireHandle();
    (current.shell!.app as { unmount(): void }).unmount();
    await current.shell!.host.close();
    const deviceId = current.deviceId;
    const tabId = current.tabId;
    handle = null;
    return this.openShell({ deviceId, withSnapshot: false, tabId });
  },

  async close() {
    const current = requireHandle();
    (current.shell!.app as { unmount(): void }).unmount();
    await current.shell!.host.close();
    handle = null;
    return { closed: true };
  },

  summary() {
    return summarize();
  },

  async selectDate(iso: string) {
    const current = requireHandle();
    await current.mounted.selectDate(iso);
    await current.mounted.$nextTick();
    return summarize();
  },

  async addExpense(input: { name: string; cost: string; category?: string }) {
    const current = requireHandle();
    current.mounted.addModal.form = {
      name: input.name,
      cost: input.cost,
      category: input.category ?? 'food',
      recurrence: 'daily',
      applicability: 'everyday',
      monthDay: '',
      classification: 'essential',
      source: 'manual',
      flexibleDefinitionId: '',
      monthlyBudget: '',
      maxUsesPerMonth: '',
    };
    current.mounted.addModal.mode = 'expense';
    current.mounted.addModal.open = true;
    await current.mounted.submitNewExpense();
    await current.mounted.$nextTick();
    return { ...summarize(), modalOpen: current.mounted.addModal.open };
  },

  async doubleSubmit(input: { name: string; cost: string; category?: string }) {
    const current = requireHandle();
    current.mounted.addModal.form = {
      name: input.name,
      cost: input.cost,
      category: input.category ?? 'food',
      recurrence: 'daily',
      applicability: 'everyday',
      monthDay: '',
      classification: '',
      source: 'manual',
      flexibleDefinitionId: '',
      monthlyBudget: '',
      maxUsesPerMonth: '',
    };
    current.mounted.addModal.mode = 'expense';
    current.mounted.addModal.open = true;
    // Two overlapping submits, like a rapid double-click: at most one
    // durable commit may result.
    await Promise.all([current.mounted.submitNewExpense(), current.mounted.submitNewExpense()]);
    await current.mounted.$nextTick();
    return { ...summarize(), modalOpen: current.mounted.addModal.open };
  },

  async openPayAttempt() {
    const current = requireHandle();
    const rows = current.shell!.featurePorts.home.listSelectedDayExpenses();
    if (rows.length === 0) throw new Error('no rows to attempt pay on');
    current.mounted.openPayModal({ ...rows[0] });
    await current.mounted.$nextTick();
    return { ...summarize(), modalOpen: current.mounted.payModal.open };
  },

  unsupportedDomState() {
    return {
      luxuryTags: document.querySelectorAll('.luxury-tag').length,
      disabledButtons: document.querySelectorAll('#app button[disabled]').length,
      classificationToggles: Array.from(document.querySelectorAll('#app button')).filter((button) => {
        const text = (button.textContent ?? '').trim();
        return text === 'Luxury' || text === 'كمالي';
      }).length,
    };
  },

  async openAddForCheck() {
    const current = requireHandle();
    current.mounted.openAddModal();
    await current.mounted.$nextTick();
    const state = {
      modalOpen: current.mounted.addModal.open,
      luxuryTags: document.querySelectorAll('.luxury-tag').length,
      classificationToggles: Array.from(document.querySelectorAll('#app button')).filter((button) => {
        const text = (button.textContent ?? '').trim();
        return text === 'Luxury' || text === 'كمالي';
      }).length,
      disabledClassificationToggles: Array.from(document.querySelectorAll('#app button[disabled]')).filter((button) => {
        const text = (button.textContent ?? '').trim();
        return text === 'Luxury' || text === 'كمالي';
      }).length,
      flexibleToggles: Array.from(document.querySelectorAll('#app button')).filter((button) => {
        const text = (button.textContent ?? '').trim();
        return text === 'Flexible' || text === 'Manual' || text === 'مرن' || text === 'يدوي';
      }).length,
    };
    current.mounted.addModal.open = false;
    await current.mounted.$nextTick();
    return state;
  },

  async saveEdit(input: { id: string; name: string; cost: string }) {
    const current = requireHandle();
    const rows = current.shell!.featurePorts.home.listSelectedDayExpenses();
    const item = rows.find((row) => row.id === input.id);
    if (!item) throw new Error(`row ${input.id} is not on the selected day`);
    current.mounted.editModal.item = { ...item };
    current.mounted.editModal.type = 'expense';
    current.mounted.editModal.form = {
      name: input.name, cost: input.cost, category: item.category, date: item.date,
      recurrence: 'daily', applicability: 'everyday', monthDay: '',
      isPaid: true, actualPaid: item.actualPaid, classification: 'essential', profileId: 'legacy',
    };
    current.mounted.editModal.open = true;
    await current.mounted.saveEditedExpense();
    await current.mounted.$nextTick();
    return { ...summarize(), modalOpen: current.mounted.editModal.open };
  },

  async deleteById(id: string) {
    const current = requireHandle();
    current.mounted.deleteExpense(id);
    await current.mounted.$nextTick();
    const dialogOpen = current.mounted.confirmDialog.open as boolean;
    if (dialogOpen && typeof current.mounted.confirmDialog.onConfirm === 'function') {
      await current.mounted.confirmDialog.onConfirm();
      current.mounted.confirmDialog.open = false;
    }
    await current.mounted.$nextTick();
    return { ...summarize(), dialogWasOpen: dialogOpen };
  },

  async tryPayBlocked() {
    const current = requireHandle();
    const rows = current.shell!.featurePorts.home.listSelectedDayExpenses();
    if (rows.length === 0) throw new Error('no rows to attempt pay on');
    current.mounted.payModal.item = { ...rows[0] };
    current.mounted.payModal.amount = '5';
    current.mounted.payModal.open = true;
    await current.mounted.commitPayment();
    await current.mounted.$nextTick();
    return { ...summarize(), modalOpen: current.mounted.payModal.open };
  },

  async refresh() {
    const current = requireHandle();
    await current.shell!.host.refresh();
    await current.mounted.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const ports = current.shell!.featurePorts;
    const rows = ports.home.listSelectedDayExpenses();
    current.mounted.store.currentViewExpenses = rows.map((row) => ({ ...row }));
    await current.mounted.$nextTick();
    return summarize();
  },

  listDay(date: string) {
    return requireHandle().shell!.featurePorts.home.listSelectedDayExpenses()
      .filter((row) => row.date === date);
  },

  bumpEpoch(reason: string) {
    return { epoch: requireHandle().shell!.coordination.bumpEpoch(reason) };
  },

  waitForInvalidate(timeoutMs = 15_000) {
    const current = requireHandle();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve({ received: false });
      }, timeoutMs);
      const unsubscribe = current.shell!.coordination.onInvalidate((message) => {
        clearTimeout(timer);
        unsubscribe();
        resolve({ received: true, storageId: message.storageId });
      });
    });
  },

  async activateUpdate() {
    const current = requireHandle();
    const fakeRegistration = { waiting: null };
    return activateCandidateUpdate(fakeRegistration, current.shell!.coordination as never, 'd3-harness-probe');
  },
};

(globalThis as Record<string, unknown>).__p04d3 = __p04d3;
