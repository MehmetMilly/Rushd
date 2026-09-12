// P04-D1: authority-state and shell feature-port contracts.
//
// These interfaces are the migration seam described in
// `docs/implementation/P04_D_RESTART_ARCHITECTURE.md` (Candidate B). D1
// defines the full port surface — Home, capture/Add, history, Plan,
// Insights, Goals, portability, navigation intent, and update lifecycle —
// while implementing only legacy delegates (see `legacy-ports.ts`). No
// canonical state is translated here, no v2 storage is opened, and no
// production path resolves to anything but `legacy` (see
// `authority-latch.ts`).

/** Build-time authority selection. D1 production always uses `legacy`. */
export type P04DBuildMode = 'legacy' | 'canonicalCandidate';

/** Discriminated finance-authority state for the visible application. */
export interface LegacyAuthorityState {
  readonly kind: 'legacy';
  /** Legacy IndexedDB remains the writable finance authority. */
  readonly writable: true;
}

/** Candidate preparation state. Writes stay blocked until D4's cutover. */
export interface CanonicalPreparingAuthorityState {
  readonly kind: 'canonicalPreparing';
  readonly writable: false;
  readonly reason: string;
}

/** Canonical production state. Not reachable in D1. */
export interface CanonicalReadyAuthorityState {
  readonly kind: 'canonicalReady';
  readonly writable: true;
  readonly storageId: string;
}

/** Fully blocked state surfaced when neither authority can serve writes. */
export interface UnavailableAuthorityState {
  readonly kind: 'unavailable';
  readonly writable: false;
  readonly reason: string;
}

export type AuthorityState =
  | LegacyAuthorityState
  | CanonicalPreparingAuthorityState
  | CanonicalReadyAuthorityState
  | UnavailableAuthorityState;

/** Every feature port owned by the shell port set. */
export type FeaturePortName =
  | 'authority'
  | 'home'
  | 'capture'
  | 'history'
  | 'plan'
  | 'insights'
  | 'goals'
  | 'portability'
  | 'navigation'
  | 'lifecycle';

/** Truthful busy/error/recovery snapshot carried by every port. */
export interface PortStatus {
  readonly busy: boolean;
  readonly error: string | null;
}

/** Guards finance writes against the resolved authority state. */
export interface AuthorityPort {
  readonly name: 'authority';
  getState(): AuthorityState;
  /**
   * Throws an `Error` naming `scope` when the resolved authority is not
   * writable. Legacy delegates call this before delegating a write.
   */
  assertWritable(scope: string): void;
  describe(): string;
  getStatus(): PortStatus;
}

/** Legacy-shaped selected-day expense row passed through to the shell. */
export interface HomeDayExpense {
  readonly id: string;
  readonly name: string;
  readonly expectedCost: number;
  readonly actualPaid: number;
  readonly isPaid: boolean;
  readonly category: string;
  readonly classification: string;
  readonly date: string;
}

/** Home/selected-day read model plus its allowed view actions. */
export interface HomePort {
  readonly name: 'home';
  getSelectedDate(): string;
  /** Monthly safe-to-spend amount, or `null` when historically unknown. */
  getSafeToSpend(): number | null;
  getDailyPaidTotal(): number;
  getDailyExpectedTotal(): number;
  listSelectedDayExpenses(): HomeDayExpense[];
  selectDate(isoDate: string): Promise<void>;
  refresh(): Promise<void>;
  getStatus(): PortStatus;
}

export interface CaptureInput {
  readonly name: string;
  readonly cost: number;
  readonly category: string;
  readonly classification?: string;
  readonly source?: 'manual' | 'flexible';
  readonly flexibleDefinitionId?: string | null;
  readonly date?: string;
  /**
   * Retry identity for one user intent. A retry after a lost
   * acknowledgement reuses the same operation ID so the gateway replays
   * idempotently; a new intent (or a reload) must mint a fresh ID that
   * cannot collide with persisted journal history.
   */
  readonly operationId?: string;
}

/** Per-intent operation identity for history mutations (D3). */
export interface HistoryMutationOptions {
  /** Retry identity for a single correction/reversal; see `CaptureInput.operationId`. */
  readonly operationId?: string;
  /** Per-entry retry identities for batch deletes, aligned with `ids`. */
  readonly operationIds?: readonly string[];
}

export interface CaptureResult {
  readonly ok: boolean;
  readonly id?: string;
  /** Machine-readable failure reason (`validation`, `blocked`, `error`). */
  readonly reason?: string;
}

/** Manual/smart capture writes. D1 delegates to the legacy Store. */
export interface CapturePort {
  readonly name: 'capture';
  submitExpense(input: CaptureInput): Promise<CaptureResult>;
  payExpense(id: string, amount: number): Promise<CaptureResult>;
  markUnpaid(id: string): Promise<CaptureResult>;
  /** Returns the number of generated template expenses (0 when blocked). */
  autoFillDay(date: string): Promise<number>;
  getStatus(): PortStatus;
}

/** Legacy-shaped expense record passed through history mutations. */
export interface HistoryExpenseRecord {
  readonly id: string;
  readonly date: string;
  readonly name: string;
  readonly expectedCost: number;
  readonly actualPaid: number;
  readonly isPaid: boolean;
  readonly category: string;
  readonly classification: string;
  readonly [key: string]: unknown;
}

/** History corrections, deletes, and bulk review actions. */
export interface HistoryPort {
  readonly name: 'history';
  listDayExpenses(date: string): Promise<HistoryExpenseRecord[]>;
  /**
   * Append-only correction: a linked reversal plus replacement through
   * `correctExpense`. The original record stays in canonical history.
   */
  updateExpense(expense: HistoryExpenseRecord, options?: HistoryMutationOptions): Promise<CaptureResult>;
  /**
   * Append-only reversal: `correctExpense` with `replacement: null`.
   * The original record stays in canonical history.
   */
  deleteExpense(id: string, options?: HistoryMutationOptions): Promise<CaptureResult>;
  /**
   * Individually confirmed append-only reversals. Never reports
   * all-success when any entry fails (`reason: 'partial'`).
   */
  deleteSelected(ids: string[], options?: HistoryMutationOptions): Promise<CaptureResult>;
  markSelectedUnpaid(ids: string[]): Promise<CaptureResult>;
  getStatus(): PortStatus;
}

export interface TemplateProfileView {
  readonly id: string;
  readonly name: string;
  readonly offdays: number[];
}

export interface TemplateApplyPreview {
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly createCount: number;
  readonly updateCount: number;
  readonly deleteCount: number;
  readonly totalChanges: number;
  readonly blocked: boolean;
  readonly blockedReason?: string;
}

/** Plan profiles, templates, assignments, and atomic apply. */
export interface PlanPort {
  readonly name: 'plan';
  listProfiles(): TemplateProfileView[];
  getActiveProfileId(): string;
  setActiveProfile(profileId: string): Promise<void>;
  createProfile(name: string): Promise<TemplateProfileView | null>;
  setProfileOffdays(profileId: string, offdays: number[]): Promise<void>;
  /** Passthrough save; legacy normalization stays inside the v1 runtime. */
  saveTemplate(template: unknown): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  saveFlexibleDefinition(definition: unknown): Promise<void>;
  previewApply(effectiveDate: string, profileId: string): Promise<TemplateApplyPreview>;
  confirmApply(effectiveDate: string, profileId: string): Promise<TemplateApplyPreview>;
  getStatus(): PortStatus;
}

export interface MonthStatisticsView {
  readonly monthKey: string;
  readonly budgetKnown: boolean;
  readonly budget: number | null;
  readonly paidSpent: number;
  readonly unpaidEssential: number;
  readonly safeToSpend: number | null;
  readonly projectedBalance: number | null;
  readonly [key: string]: unknown;
}

/** Insights is read-only in D1; derivations stay in the legacy Store. */
export interface InsightsPort {
  readonly name: 'insights';
  getMonthStatistics(monthKey?: string): MonthStatisticsView;
  getCategoryBreakdown(): Array<{ category: string; amount: number; count: number }>;
  getWeeklySpending(): Array<{ week: number; amount: number }>;
  refresh(referenceDate?: string): Promise<void>;
  getStatus(): PortStatus;
}

export interface VaultGoalInput {
  readonly name: string;
  readonly targetAmount: number;
  readonly allocatedAmount?: number;
}

export interface MonthEndSummaryInput {
  readonly previousMonthKey: string;
  readonly previousMonthBudget?: number;
  readonly previousMonthSpent?: number;
  readonly surplus?: number;
  readonly [key: string]: unknown;
}

/** Vault goals, surplus movement, and month-end settlement. */
export interface GoalsPort {
  readonly name: 'goals';
  getVaultBalance(): number;
  listGoals(): Array<{ id: string; name: string; targetAmount: number; allocatedAmount: number }>;
  addGoal(goal: VaultGoalInput): Promise<{ id: string } | null>;
  deleteGoal(goalId: string): Promise<boolean>;
  settleToVault(summary: MonthEndSummaryInput, referenceDate?: string): Promise<unknown>;
  settleToBudget(summary: MonthEndSummaryInput, referenceDate?: string): Promise<unknown>;
  settleNoSurplus(summary: MonthEndSummaryInput, referenceDate?: string): Promise<unknown>;
  getStatus(): PortStatus;
}

/** Versioned export/import/reset. D1 delegates to the v1 backup path. */
export interface PortabilityPort {
  readonly name: 'portability';
  buildSnapshot(): Promise<string>;
  /**
   * Restores a validated backup snapshot. Validation stays inside the
   * legacy `validateBackupPayload` gate; this port never invents data.
   */
  restoreSnapshot(snapshot: unknown): Promise<{ ok: boolean; reason: string }>;
  factoryReset(onBlocked?: (() => void) | null): Promise<void>;
  clearLocalPreferences(): void;
  getStatus(): PortStatus;
}

/** Permanent-destination intent. Coexists with the mounted legacy shell. */
export interface NavigationIntent {
  readonly view: 'dashboard' | 'statistics' | 'vault' | 'plans' | 'settings';
  readonly date?: string;
}

/**
 * Navigation intent mapping. D1 only maps the five populated legacy
 * destinations; it never replaces a working screen with a blank shell.
 */
export interface NavigationIntentPort {
  readonly name: 'navigation';
  /** Returns `null` for unknown destinations instead of guessing. */
  resolveIntent(view: string, date?: string): NavigationIntent | null;
  listDestinations(): NavigationIntent['view'][];
  getStatus(): PortStatus;
}

export interface AppSettingsView {
  readonly baseAllowance: number;
  readonly theme: string;
  readonly motionLevel: string;
  readonly language: string;
  readonly calendarType: string;
  readonly activeTemplateProfileId: string;
  readonly [key: string]: unknown;
}

export interface OnboardingStateView {
  readonly status: string;
  readonly updatedAt: string;
  readonly source: string;
}

/** Update lifecycle: boot, preferences, onboarding, and prompt deferrals. */
export interface UpdateLifecyclePort {
  readonly name: 'lifecycle';
  initialize(): Promise<void>;
  getSettings(): AppSettingsView;
  saveBaseAllowance(amount: number): Promise<boolean>;
  setTheme(theme: string): Promise<void>;
  setMotionLevel(level: string): Promise<void>;
  setLanguage(language: string): void;
  setCalendarType(calendarType: string): void;
  getOnboardingState(): OnboardingStateView | null;
  persistOnboardingState(status: string, source?: string): Promise<OnboardingStateView>;
  getMonthStartDeferral(): unknown;
  deferMonthStartPrompt(referenceDate: string): void;
  clearMonthStartDeferral(): void;
  getMonthEndDeferral(): unknown;
  deferMonthEndPrompt(previousMonthKey: string, referenceDate: string): void;
  clearMonthEndDeferral(): void;
  getStatus(): PortStatus;
}

/** The complete shell port set injected at the application boundary. */
export interface ShellFeaturePorts {
  readonly authority: AuthorityPort;
  readonly home: HomePort;
  readonly capture: CapturePort;
  readonly history: HistoryPort;
  readonly plan: PlanPort;
  readonly insights: InsightsPort;
  readonly goals: GoalsPort;
  readonly portability: PortabilityPort;
  readonly navigation: NavigationIntentPort;
  readonly lifecycle: UpdateLifecyclePort;
}

/** Explicit test/build injection. Never populated from runtime inputs. */
export interface P04DAuthorityRequest {
  readonly mode?: P04DBuildMode;
  readonly candidatePorts?: ShellFeaturePorts | null;
}

export interface P04DAuthorityResolution {
  readonly mode: P04DBuildMode;
  readonly authority: AuthorityState;
  readonly featurePorts: ShellFeaturePorts;
}
