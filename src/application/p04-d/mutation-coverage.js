// P04-D4: post-cutover mutation-ownership inventory.
//
// After the production authority cutover every enabled
// `src/app/root-controller.js` action capable of changing finance,
// settings, import, or reset state routes through exactly one canonical
// feature port. Legacy delegates still exist in the method bodies for the
// pre-cutover path, but production never reaches them: v1 writers are
// frozen at boot and the controller branches to ports first. Each row
// below therefore names the CANONICAL owner (command or truthful refusal),
// not the v1 primitive. The accompanying test
// (`tests/application/p04-d-mutation-coverage.test.mjs`, run from
// `npm run test:p04d4`) re-derives the writer set from the controller
// source (direct v1 persistence signals plus transitive calls into
// covered writers) and fails on any missing or doubly-owned action.
//
// Truthfully disabled actions are owned by refusal: the port (or the
// controller seam before it) rejects without writing, the control is
// disabled via `p04dCandidateActive`, and no v1 or canonical writer runs.
// A missing, duplicate, direct-v1, or unclassified writer fails the gate.
//
// Ownership rationale for multi-branch actions: `saveEditedExpense`,
// `deleteEditedExpense`, and `submitNewExpense` each branch by record
// type. Expense branches correct/reverse through history/capture ports;
// template/flexible branches are visibly blocked (plan has no
// canonical counterpart for profiles, and plans are append-only).
//
// D2 note: this module follows the established `.js` + `.d.ts` runtime
// pattern (like `legacy-ports.js`) so the TypeScript barrel
// (`./index.ts`) resolves the same specifier in the bundler, `tsc`, and
// plain-Node test environments. Types live in `./mutation-coverage.d.ts`.

/**
 * @typedef {import('./contracts.js').FeaturePortName} FeaturePortName
 * @typedef {object} MutationOwnerEntry
 * @property {string} action Exact controller method name in `src/app/root-controller.js`.
 * @property {FeaturePortName} port The single feature port that owns this mutation.
 * @property {string} reason Short note naming the canonical command or truthful refusal.
 */

/**
 * Complete D4 inventory. Keep sorted by port, then action, so diffs stay
 * reviewable. Adding a new mutating controller action without a row here is
 * a test failure by design.
 * @type {readonly MutationOwnerEntry[]}
 */
export const MUTATION_COVERAGE_INVENTORY = Object.freeze([
  // Capture: manual add commits; payment semantics stay blocked (a paid
  // actual has no unpaid counterpart — correct or reverse instead).
  { action: 'autoFillToday', port: 'capture', reason: 'capture port refuses: template generation has no canonical owner; never v1' },
  { action: 'commitPayment', port: 'capture', reason: 'capture port refuses: pay/reopen has no canonical equivalent; never v1' },
  { action: 'markAsFree', port: 'capture', reason: 'transitive via commitPayment refusal' },
  { action: 'markUnpaid', port: 'capture', reason: 'capture port refuses: reopen has no canonical equivalent; never v1' },
  { action: 'submitNewExpense', port: 'capture', reason: 'capture.recordExpense for manual actuals; template/flexible branches visibly blocked' },

  // History: append-only corrections and reversals; bulk unpaid blocked.
  { action: 'deleteEditedExpense', port: 'history', reason: 'history reversal (correctExpense, replacement null); template branch blocked' },
  { action: 'deleteExpense', port: 'history', reason: 'history reversal (correctExpense, replacement null)' },
  { action: 'deleteSelectedExpenses', port: 'history', reason: 'one history reversal per entry with explicit partial failure' },
  { action: 'markSelectedUnpaid', port: 'history', reason: 'history port refuses: bulk mark-unpaid has no canonical equivalent; never v1' },
  { action: 'saveEditedExpense', port: 'history', reason: 'history linked correction (correctExpense); template branch blocked' },

  // Plan: recurring rules are append-only; profiles have no counterpart.
  { action: 'confirmTemplateApplication', port: 'plan', reason: 'plan.confirmApply: materializePlanOccurrences per plan, all-or-blocked' },
  { action: 'confirmTemplateApplicationViaPorts', port: 'plan', reason: 'canonical apply helper: stable per-plan identities, modal closes only on durable success' },
  { action: 'createTemplateProfile', port: 'plan', reason: 'plan port refuses: profiles have no canonical counterpart; never v1' },
  { action: 'deleteTemplate', port: 'plan', reason: 'plan port refuses: rules are append-only, no delete command; never v1' },
  { action: 'finishOnboarding', port: 'plan', reason: 'visibly blocked: onboarding setup has no canonical path; never v1' },
  { action: 'persistOnboardingTemplateItems', port: 'plan', reason: 'visibly blocked: onboarding plan staging has no canonical path; never v1' },
  { action: 'resolveOnboardingTargetProfileId', port: 'plan', reason: 'visibly blocked: onboarding profiles have no canonical counterpart; never v1' },
  { action: 'setActiveTemplateProfile', port: 'plan', reason: 'plan port refuses: profiles have no canonical counterpart; never v1' },
  { action: 'toggleCurrentProfileOffday', port: 'plan', reason: 'plan port refuses: offdays have no canonical counterpart; never v1' },

  // Goals: explicit creation/assignment and month-end settlement; deletion
  // and auto-settle stay out (append-only; explicit user decision).
  { action: 'addMonthEndSurplusToBudget', port: 'goals', reason: 'goals.settleToBudget: closeCycle plus carryIn disposition' },
  { action: 'addVaultGoal', port: 'goals', reason: 'goals.createGoal plus explicit opening assignToGoal for user-provided allocations' },
  { action: 'confirmDeleteVaultGoal', port: 'goals', reason: 'goals port refuses: goals are append-only, no delete command; never v1' },
  { action: 'maybeHandleMonthEndDecision', port: 'goals', reason: 'auto-settle disabled in candidate mode; explicit settle* ports own the decision' },
  { action: 'moveMonthEndSurplusToVault', port: 'goals', reason: 'goals.settleToVault: closeCycle plus fundTracked disposition' },
  { action: 'settleMonthEndViaPorts', port: 'goals', reason: 'canonical settle helper: durable close plus dispose before any success surfaces' },

  // Portability: versioned export/import/reset through P04-C commit points.
  { action: 'clearRushdLocalState', port: 'portability', reason: 'portability.clearLocalPreferences: UI chrome only, device id preserved' },
  { action: 'importData', port: 'portability', reason: 'portability.restoreSnapshot: preview plus importPortableReplacement commit point' },
  { action: 'resetApp', port: 'portability', reason: 'portability export-first safety backup plus resetGuestScope commit point' },
  { action: 'resetAppViaPorts', port: 'portability', reason: 'canonical reset helper: safety backup downloads before anything destructive runs' },

  // Lifecycle: boot, preferences, onboarding flow state, prompt deferrals.
  { action: 'applyMotionProfile', port: 'lifecycle', reason: 'DOM chrome apply; persistence belongs to the lifecycle port in candidate mode' },
  { action: 'applyTheme', port: 'lifecycle', reason: 'DOM chrome apply; persistence belongs to the lifecycle port in candidate mode' },
  { action: 'clearMonthEndPromptDeferral', port: 'lifecycle', reason: 'lifecycle.clearMonthEndDeferral local chrome write' },
  { action: 'clearMonthStartPromptDeferral', port: 'lifecycle', reason: 'lifecycle.clearMonthStartDeferral local chrome write' },
  { action: 'decideMonthEndPromptLater', port: 'lifecycle', reason: 'transitive via deferMonthEndPrompt' },
  { action: 'decideMonthStartPromptLater', port: 'lifecycle', reason: 'transitive via deferMonthStartPrompt' },
  { action: 'deferMonthEndPrompt', port: 'lifecycle', reason: 'lifecycle.deferMonthEndPrompt local chrome write' },
  { action: 'deferMonthStartPrompt', port: 'lifecycle', reason: 'lifecycle.deferMonthStartPrompt local chrome write' },
  { action: 'handleApplyTemplatesModalVisibilityChange', port: 'lifecycle', reason: 'transitive via decideMonthStartPromptLater' },
  { action: 'handleMonthEndModalVisibilityChange', port: 'lifecycle', reason: 'transitive via decideMonthEndPromptLater' },
  { action: 'handleOnboardingModalVisibilityChange', port: 'lifecycle', reason: 'closes without persisting in candidate mode; never v1' },
  { action: 'initApp', port: 'lifecycle', reason: 'lifecycle.initialize plus canonical mirrors and nav restore; v1 init/onboarding/month-end flows stay out' },
  { action: 'maybeOpenMonthStartPrompt', port: 'lifecycle', reason: 'disabled in candidate mode; materialization runs explicitly from Plans' },
  { action: 'persistOnboardingState', port: 'lifecycle', reason: 'lifecycle local flow-status write; failures keep prior state' },
  { action: 'resolveOnboardingStatus', port: 'lifecycle', reason: 'lifecycle local flow-status read; migrated books count as completed' },
  { action: 'saveSettings', port: 'lifecycle', reason: 'visibly blocked: allowance is read-only migrated history; never v1' },
  { action: 'setCalendarType', port: 'lifecycle', reason: 'lifecycle local preference write' },
  { action: 'setLang', port: 'lifecycle', reason: 'lifecycle local preference write' },
  { action: 'setMotionLevel', port: 'lifecycle', reason: 'lifecycle local preference write' },
  { action: 'setTheme', port: 'lifecycle', reason: 'lifecycle local preference write' },
  { action: 'shouldShowMonthStartPrompt', port: 'lifecycle', reason: 'disabled in candidate mode; never arms a v1 prompt' },
  { action: 'skipOnboardingForNow', port: 'lifecycle', reason: 'transitive via persistOnboardingState' },
]);

/** Actions in the inventory, in declared order. @returns {string[]} */
export function inventoryActions() {
  return MUTATION_COVERAGE_INVENTORY.map((entry) => entry.action);
}

/** Actions claimed by more than one port. Must always be empty. @returns {string[]} */
export function findDuplicateOwners() {
  const seen = new Map();
  const duplicates = new Set();
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

/**
 * Inventory actions missing from `detected` controller writers.
 * @param {readonly string[]} detected
 * @returns {string[]}
 */
export function findMissingOwners(detected) {
  const covered = new Set(inventoryActions());
  return detected.filter((action) => !covered.has(action)).sort();
}

/**
 * Inventory rows that name no detected writer and no known method.
 * @param {readonly string[]} knownMethods
 * @returns {string[]}
 */
export function findStaleEntries(knownMethods) {
  const known = new Set(knownMethods);
  return inventoryActions().filter((action) => !known.has(action)).sort();
}
