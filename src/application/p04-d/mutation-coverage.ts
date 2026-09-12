// P04-D1: mechanical mutation-coverage inventory.
//
// Every currently enabled `src/app/root-controller.js` action capable of
// changing finance, settings, import, or reset state is named here with its
// single owning feature port. The accompanying test
// (`tests/application/p04-d-mutation-coverage.test.mjs`) re-derives the
// writer set from the controller source (direct v1 persistence signals plus
// transitive calls into covered writers) and fails on any missing or
// doubly-owned action.
//
// Ownership rationale for dual-scope actions: `saveEditedExpense`,
// `deleteEditedExpense`, and `submitNewExpense` each touch two stores
// depending on their mode. In D1 they keep ONE owner each (history for the
// expense corrections, capture for the add entry point); the template branch
// is documented as plan-delegated work that D3/D4 splits into distinct
// canonical ports. The latch release gate (D4) requires the split before
// the production cutover.

import type { FeaturePortName } from './contracts.js';

export interface MutationOwnerEntry {
  /** Exact controller method name in `src/app/root-controller.js`. */
  readonly action: string;
  /** The single feature port that owns this mutation. */
  readonly port: FeaturePortName;
  /** Short note naming the delegated v1 primitive. */
  readonly reason: string;
}

/**
 * Complete D1 inventory. Keep sorted by port, then action, so diffs stay
 * reviewable. Adding a new mutating controller action without a row here is
 * a test failure by design.
 */
export const MUTATION_COVERAGE_INVENTORY: readonly MutationOwnerEntry[] = [
  // Capture: manual/smart add and payment.
  { action: 'autoFillToday', port: 'capture', reason: 'Store.autoFillDay template generation' },
  { action: 'commitPayment', port: 'capture', reason: 'Store.updateExpense pay with amount' },
  { action: 'markAsFree', port: 'capture', reason: 'transitive via commitPayment with amount 0' },
  { action: 'markUnpaid', port: 'capture', reason: 'Store.updateExpense reopen from pay modal' },
  { action: 'submitNewExpense', port: 'capture', reason: 'Store.addExpense; template/flexible branches delegate to DB.saveTemplate (plan split in D3)' },

  // History: corrections, deletes, bulk review.
  { action: 'deleteEditedExpense', port: 'history', reason: 'Store.deleteExpense; template branch delegates to DB.deleteTemplate (plan split in D3)' },
  { action: 'deleteExpense', port: 'history', reason: 'Store.deleteExpense single expense' },
  { action: 'deleteSelectedExpenses', port: 'history', reason: 'Store.deleteExpense loop over selection' },
  { action: 'markSelectedUnpaid', port: 'history', reason: 'Store.updateExpense loop over paid selection' },
  { action: 'saveEditedExpense', port: 'history', reason: 'Store.updateExpense; template branch delegates to DB.saveTemplate (plan split in D3)' },

  // Plan: profiles, templates, assignments, atomic apply.
  { action: 'confirmTemplateApplication', port: 'plan', reason: 'Store.applyTemplatesFrom atomic plan apply' },
  { action: 'createTemplateProfile', port: 'plan', reason: 'DB.setSetting templateProfiles' },
  { action: 'deleteTemplate', port: 'plan', reason: 'DB.deleteTemplate recurring rule' },
  { action: 'finishOnboarding', port: 'plan', reason: 'budget/profile/template setup plus Store.applyTemplatesFrom' },
  { action: 'persistOnboardingTemplateItems', port: 'plan', reason: 'DB.saveTemplate/DB.deleteTemplate staged plan items' },
  { action: 'resolveOnboardingTargetProfileId', port: 'plan', reason: 'DB.setSetting templateProfiles for new/kept profile' },
  { action: 'setActiveTemplateProfile', port: 'plan', reason: 'DB.setSetting activeTemplateProfileId' },
  { action: 'toggleCurrentProfileOffday', port: 'plan', reason: 'DB.setSetting templateProfiles offdays' },

  // Goals: vault goals and month-end settlement.
  { action: 'addMonthEndSurplusToBudget', port: 'goals', reason: 'Store.settleMonthEndToBudget surplus carry' },
  { action: 'addVaultGoal', port: 'goals', reason: 'Store.addVaultGoal tracked-pool goal' },
  { action: 'confirmDeleteVaultGoal', port: 'goals', reason: 'Store.deleteVaultGoal tracked-pool goal' },
  { action: 'maybeHandleMonthEndDecision', port: 'goals', reason: 'Store.settleMonthEndNoSurplus auto-settle plus deferral writes' },
  { action: 'moveMonthEndSurplusToVault', port: 'goals', reason: 'Store.settleMonthEndToVault surplus movement' },

  // Portability: import, export-first reset, preference clearing.
  { action: 'clearRushdLocalState', port: 'portability', reason: 'localStorage rushd_/microsave_ preference removal' },
  { action: 'importData', port: 'portability', reason: 'DB.restoreBackupRecords atomic import plus Store.init' },
  { action: 'resetApp', port: 'portability', reason: 'DB.factoryReset after export-first safety backup' },

  // Lifecycle: boot, preferences, onboarding state, prompt deferrals.
  { action: 'applyMotionProfile', port: 'lifecycle', reason: 'localStorage rushd_motion mirror plus reactive settings' },
  { action: 'applyTheme', port: 'lifecycle', reason: 'localStorage rushd_theme mirror plus reactive settings' },
  { action: 'clearMonthEndPromptDeferral', port: 'lifecycle', reason: 'localStorage month-end deferral removal' },
  { action: 'clearMonthStartPromptDeferral', port: 'lifecycle', reason: 'localStorage month-start deferral removal' },
  { action: 'decideMonthEndPromptLater', port: 'lifecycle', reason: 'transitive via deferMonthEndPrompt' },
  { action: 'decideMonthStartPromptLater', port: 'lifecycle', reason: 'transitive via deferMonthStartPrompt' },
  { action: 'deferMonthEndPrompt', port: 'lifecycle', reason: 'localStorage month-end deferral write' },
  { action: 'deferMonthStartPrompt', port: 'lifecycle', reason: 'localStorage month-start deferral write' },
  { action: 'handleApplyTemplatesModalVisibilityChange', port: 'lifecycle', reason: 'transitive via decideMonthStartPromptLater' },
  { action: 'handleMonthEndModalVisibilityChange', port: 'lifecycle', reason: 'transitive via decideMonthEndPromptLater' },
  { action: 'handleOnboardingModalVisibilityChange', port: 'lifecycle', reason: 'transitive via skipOnboardingForNow' },
  { action: 'initApp', port: 'lifecycle', reason: 'Store.init defaults/cleanup plus import-flag handling' },
  { action: 'maybeOpenMonthStartPrompt', port: 'lifecycle', reason: 'transitive via shouldShowMonthStartPrompt (conditional deferral clear)' },
  { action: 'persistOnboardingState', port: 'lifecycle', reason: 'DB.setSetting onboardingState' },
  { action: 'resolveOnboardingStatus', port: 'lifecycle', reason: 'transitive via persistOnboardingState for existing data' },
  { action: 'saveSettings', port: 'lifecycle', reason: 'DB.setSetting baseAllowance plus month snapshot' },
  { action: 'setCalendarType', port: 'lifecycle', reason: 'localStorage rushd_calendar mirror' },
  { action: 'setLang', port: 'lifecycle', reason: 'localStorage rushd_lang mirror' },
  { action: 'setMotionLevel', port: 'lifecycle', reason: 'DB.setSetting motionLevel plus localStorage mirror' },
  { action: 'setTheme', port: 'lifecycle', reason: 'DB.setSetting theme plus localStorage mirror' },
  { action: 'shouldShowMonthStartPrompt', port: 'lifecycle', reason: 'conditionally clears the month-start deferral' },
  { action: 'skipOnboardingForNow', port: 'lifecycle', reason: 'transitive via persistOnboardingState' },
];

/** Actions in the inventory, in declared order. */
export function inventoryActions(): string[] {
  return MUTATION_COVERAGE_INVENTORY.map((entry) => entry.action);
}

/** Actions claimed by more than one port. Must always be empty. */
export function findDuplicateOwners(): string[] {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const entry of MUTATION_COVERAGE_INVENTORY) {
    const owner = seen.get(entry.action);
    if (owner === undefined) {
      seen.set(entry.action, entry.port);
    } else if (owner !== entry.port) {
      duplicates.add(entry.action);
    } else {
      duplicates.add(entry.action);
    }
  }
  return [...duplicates].sort();
}

/** Inventory actions missing from `detected` controller writers. */
export function findMissingOwners(detected: readonly string[]): string[] {
  const covered = new Set(inventoryActions());
  return detected.filter((action) => !covered.has(action)).sort();
}

/** Inventory rows that name no detected writer and no known method. */
export function findStaleEntries(knownMethods: readonly string[]): string[] {
  const known = new Set(knownMethods);
  return inventoryActions().filter((action) => !known.has(action)).sort();
}
