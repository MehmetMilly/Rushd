// P02 compatibility controller. P05/P06 own component and route redesign.
import { Core } from '../shared/core.js';
import { TRANSLATIONS } from './i18n/translations.js';
import { registerProfileOverlay } from '../components/register-profile-overlay.js';

export function installRootController(app, dataRuntime, environment = globalThis, options = {}) {
    // P04-D1 compatibility seam: an explicit feature-port set may be injected
    // for tests and the future canonical migration. The mounted controller
    // keeps delegating to the legacy DB/Store exactly as before; the ports
    // are exposed read-only for inspection and do not change any behavior.
    const injectedPorts = options && typeof options === 'object' ? options.featurePorts : null;
    // P04-D3 candidate seam: D3-owned Home/Add/Transactions actions read
    // and write through the injected feature ports when the resolved
    // authority is non-legacy. Legacy mode keeps delegating to the v1
    // DB/Store exactly as before. The controller never resolves authority
    // itself: it only branches on the injected port set's live state, and
    // candidate mode is reachable only through explicit build/test
    // injection (never URL, storage, or globals).
    const p04dCandidatePorts = injectedPorts && typeof injectedPorts === 'object' ? injectedPorts : null;
    const p04dAuthorityState = () => {
        try {
            return p04dCandidatePorts && p04dCandidatePorts.authority
                ? p04dCandidatePorts.authority.getState()
                : null;
        } catch {
            return null;
        }
    };
    // True when the injected ports carry a non-legacy authority (the
    // candidate host's preparing/ready/blocked states).
    const p04dIsCandidate = () => {
        const state = p04dAuthorityState();
        return !!state && state.kind !== 'legacy';
    };
    const p04dIsWritable = () => {
        const state = p04dAuthorityState();
        return !!state && state.writable === true;
    };
    // Candidate-blocked copy lives here (not in the translation catalog)
    // because candidate mode is test/build-only scaffolding text until the
    // D4/P06 product copy lands. Both launch languages stay first-class.
    const p04dBlockedCopy = (lang, key) => {
        const arabic = lang === 'ar';
        switch (key) {
            case 'template':
                return arabic ? 'إنشاء القوالب غير متاح في وضع المراجعة؛ لم يُحفظ شيء.' : 'Template creation is unavailable in review mode; nothing was saved.';
            case 'flexible':
                return arabic ? 'العناصر المرنة غير متاحة في وضع المراجعة؛ لم يُحفظ شيء.' : 'Flexible items are unavailable in review mode; nothing was saved.';
            case 'pay':
                return arabic ? 'الدفع وإعادة الفتح غير متاحين هنا؛ صحّح المصروف أو اعكسه من السجل.' : 'Pay and reopen are unavailable here; correct or reverse the expense from history instead.';
            case 'autofill':
                return arabic ? 'الملء التلقائي غير متاح في وضع المراجعة.' : 'Auto-fill is unavailable in review mode.';
            case 'bulkUnpaid':
                return arabic ? 'إلغاء الدفع الجماعي غير متاح؛ اعكس المصاريف واحدًا واحدًا.' : 'Bulk mark-unpaid is unavailable; reverse expenses individually.';
            case 'partial':
                return arabic ? 'تعذّر عكس بعض المصاريف؛ الباقي ظاهر في القائمة ويمكن إعادة المحاولة.' : 'Some expenses could not be reversed; the rest are still listed and can be retried.';
            case 'profile':
                return arabic ? 'ملفات القوالب والإجازات غير متاحة هنا؛ الخطط المتكررة تحمل جدولها الخاص.' : 'Template profiles and offdays are unavailable here; recurring plans carry their own schedule.';
            case 'templateDelete':
                return arabic ? 'لا يمكن حذف القواعد المتكررة؛ عدّل حدثًا أو افصله بدلًا من ذلك.' : 'Recurring rules cannot be deleted; revise or detach an occurrence instead.';
            case 'goalDelete':
                return arabic ? 'لا يمكن حذف الأهداف؛ ألغِ التخصيص وحرّر المبلغ بدلًا من ذلك.' : 'Goals cannot be deleted; unassign and release the allocation instead.';
            case 'allowance':
                return arabic ? 'الميزانية الشهرية سجل تاريخي للقراءة فقط بعد الترحيل؛ لا يمكن تعديلها.' : 'The monthly allowance is read-only migrated history; it cannot be rewritten.';
            case 'onboarding':
                return arabic ? 'الإعداد الأولي مكتمل بعد الترحيل؛ لا حاجة لإعادة الإعداد.' : 'Setup is complete after migration; no need to set up again.';
            case 'monthEnd':
                return arabic ? 'إغلاق الشهر غير متاح تلقائيًا هنا؛ أغلق الدورة صراحة من الأهداف.' : 'Automatic month-end close is unavailable here; close the cycle explicitly from Goals.';
            case 'authority':
                return arabic ? 'الكتابة محظورة حاليًا؛ أعد التحميل وحاول مجددًا.' : 'Writes are currently blocked; reload and try again.';
            default:
                return arabic ? 'وضع المراجعة غير جاهز بعد؛ العرض فقط حاليًا.' : 'Review mode is not ready yet; view-only for now.';
        }
    };
    // P04-D3 correction: one stable operation identity per open UI intent.
    // Add, edit, single delete, and batch delete keep their ID (or exact
    // per-item ID set) across retries after any false/ambiguous failure,
    // including commit-then-`ok:false` and post-commit refresh failure, so
    // a retry replays idempotently instead of duplicating the actual. A
    // new ID is minted only for a genuinely new intent: after success,
    // explicit cancel/close, reload, or a changed payload (an ID is never
    // reused for different payloads). Slots are plain closure state, never
    // finance truth: success paths always resync committed state before
    // the next intent can start.
    const p04dIntentStore = { add: null, edit: null, confirm: null, plan: null, goal: null, import: null, reset: null };
    const p04dMintIntentId = () => {
        let uuid = null;
        try {
            const factory = dataRuntime && dataRuntime.Core && dataRuntime.Core.UUID;
            if (typeof factory === 'function') uuid = factory.call(dataRuntime.Core);
        } catch {
            uuid = null;
        }
        if (typeof uuid !== 'string' || !uuid) {
            try {
                if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
                    uuid = globalThis.crypto.randomUUID();
                }
            } catch {
                uuid = null;
            }
        }
        if (typeof uuid !== 'string' || !uuid) {
            uuid = `u${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}`;
        }
        return `op-${uuid}`.slice(0, 100);
    };
    const p04dFingerprint = (value) => {
        try {
            return JSON.stringify(value ?? null);
        } catch {
            return null;
        }
    };
    // Reuse the slot's ID when the payload fingerprint is unchanged
    // (retry of the same intent); mint when the slot is empty, cleared, or
    // the payload changed. A null fingerprint never matches, so an
    // unserializable payload always mints fresh instead of colliding.
    const p04dIntentOperationId = (slot, fingerprint) => {
        const current = p04dIntentStore[slot];
        if (current && current.operationId && current.fingerprint !== null && current.fingerprint === fingerprint) {
            return current.operationId;
        }
        const operationId = p04dMintIntentId();
        p04dIntentStore[slot] = { operationId, fingerprint };
        return operationId;
    };
    const p04dClearIntent = (slot) => {
        p04dIntentStore[slot] = null;
    };
    // Batch/single-delete confirm slot: reuse the exact per-item ID set
    // when the entry set (and date) matches, mint otherwise.
    const p04dConfirmIds = (key, ids) => {
        const current = p04dIntentStore.confirm;
        if (current && current.key === key && Array.isArray(current.operationIds)
            && current.operationIds.length === ids.length) {
            return current.operationIds;
        }
        const operationIds = ids.map(() => p04dMintIntentId());
        p04dIntentStore.confirm = { key, operationId: operationIds[0], operationIds };
        return operationIds;
    };
    // Mirror the canonical Home read model into the reactive view state so
    // the established template renders committed canonical rows with no
    // visual change. This assigns only in-memory view fields; it never
    // reads or writes v1 finance persistence.
    const syncP04DCandidateHome = async (vm) => {
        const ports = p04dCandidatePorts;
        if (!ports) return;
        try {
            if (typeof ports.home.refresh === 'function') await ports.home.refresh();
        } catch {
            /* a failed refresh keeps the last committed rows; writers stay gated */
        }
        const rows = ports.home.listSelectedDayExpenses();
        vm.store.currentViewExpenses = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
        try {
            vm.store.currentDate = ports.home.getSelectedDate() || vm.store.currentDate;
        } catch {
            /* keep the current date on read failure */
        }
        // D4: Home safe-to-spend is canonical availability. The monthly
        // budget still has no canonical fact, so `budgetKnown` stays false
        // and `Store.safeToSpend` remains unknown. The hero reads
        // `p04dSafeToSpend` instead of inventing a budget.
        try {
            const amount = ports.home.getSafeToSpend();
            vm.p04dSafeToSpend = amount === null || amount === undefined || !Number.isFinite(Number(amount))
                ? null
                : Number(amount);
        } catch {
            vm.p04dSafeToSpend = null;
        }
        try {
            if (vm.store.statistics) vm.store.statistics.budgetKnown = false;
        } catch {
            /* the hero keeps its last state on mirror failure */
        }
    };
    // P04-D4: canonical mirrors for the remaining ports. Each assigns only
    // in-memory view fields the established template already binds; none
    // reads or writes v1 finance persistence. Legacy-shaped display rows
    // carry committed canonical facts (amounts, notes, dates) with no
    // invented fields.
    const syncP04DCandidatePlan = async (vm) => {
        const ports = p04dCandidatePorts;
        if (!ports) return;
        try {
            const summaries = ports.plan.listPlans();
            // D4 correction: mirror only committed plan fields. Canonical
            // recurring plans are monthly rules by construction, so
            // `recurrence: 'monthly'` restates the model, not an invented
            // assignment. `applicability` (a daily-schedule workday/offday
            // notion) is omitted — never labeled `everyday`. A missing
            // schedule day yields no days rather than a defaulted day 1.
            vm.store.templates = (Array.isArray(summaries) ? summaries : []).map((summary) => ({
                id: summary.planId,
                name: summary.name,
                expectedCost: summary.amount,
                defaultAmount: summary.amount,
                days: summary.scheduleDay != null ? [summary.scheduleDay] : [],
                source: summary.flexibleDefinitionId ? 'flexible' : 'template',
                recurrence: 'monthly',
                profileId: '',
            }));
        } catch {
            /* the Plan view keeps its last committed rows on mirror failure */
        }
        try {
            vm.store.settings.templateProfiles = [];
            vm.store.settings.activeTemplateProfileId = '';
        } catch {
            /* profile chrome keeps its last state; profiles stay empty by design */
        }
    };
    const syncP04DCandidateInsights = async (vm) => {
        const ports = p04dCandidatePorts;
        if (!ports) return;
        try {
            if (typeof ports.insights.refresh === 'function') await ports.insights.refresh();
        } catch {
            /* a failed refresh keeps the last committed month */
        }
        try {
            const stats = ports.insights.getMonthStatistics();
            if (stats && vm.store.statistics) {
                vm.store.statistics.monthKey = stats.monthKey || vm.store.statistics.monthKey;
                vm.store.statistics.budgetKnown = false;
                vm.store.statistics.budget = null;
                vm.store.statistics.paidSpent = stats.paidSpent || 0;
                vm.store.statistics.unpaidEssential = stats.unpaidEssential || 0;
                vm.store.statistics.safeToSpend = stats.safeToSpend === null || stats.safeToSpend === undefined
                    ? null
                    : stats.safeToSpend;
                vm.store.statistics.projectedBalance = stats.projectedBalance === null || stats.projectedBalance === undefined
                    ? null
                    : stats.projectedBalance;
                vm.store.statistics.categoryBreakdown = ports.insights.getCategoryBreakdown();
                vm.store.statistics.weeklySpending = ports.insights.getWeeklySpending();
            }
        } catch {
            /* the Insights view keeps its last committed month on failure */
        }
        try {
            const goals = ports.goals;
            if (vm.store.settings && vm.store.settings.vault) {
                vm.store.settings.vault.balance = goals.getVaultBalance();
                vm.store.settings.vault.goals = goals.listGoals();
            }
        } catch {
            /* the vault view keeps its last committed state on failure */
        }
    };
    const syncP04DCandidateGoals = async (vm) => {
        const ports = p04dCandidatePorts;
        if (!ports) return;
        try {
            if (vm.store.settings && vm.store.settings.vault) {
                vm.store.settings.vault.balance = ports.goals.getVaultBalance();
                vm.store.settings.vault.goals = ports.goals.listGoals();
            }
        } catch {
            /* the vault view keeps its last committed state on failure */
        }
    };
    const syncP04DCandidateSettings = async (vm) => {
        const ports = p04dCandidatePorts;
        if (!ports) return;
        try {
            const settings = ports.lifecycle.getSettings();
            if (settings && vm.store.settings) {
                vm.store.settings.baseAllowance = settings.baseAllowance;
                vm.store.settings.theme = settings.theme;
                vm.store.settings.motionLevel = settings.motionLevel;
            }
        } catch {
            /* settings chrome keeps its last state on mirror failure */
        }
    };
    // P04-D4: persist the visible route/date intent through the navigation
    // port (UI chrome only, never finance truth) so refresh, installed
    // offline launch, and update recovery restore the destination.
    const p04dPersistNavIntent = (vm) => {
        try {
            const ports = p04dCandidatePorts;
            if (!ports || typeof ports.navigation.persistIntent !== 'function') return;
            const resolved = ports.navigation.resolveIntent(vm.currentView, vm.store.currentDate);
            if (resolved) ports.navigation.persistIntent(resolved);
        } catch {
            /* navigation persistence is best-effort chrome */
        }
    };
    if (injectedPorts && app && app.config && app.config.globalProperties) {
        // D2 residual fix: expose the port set as a read-only inspection
        // handle so outside code cannot swap or relabel the authority cell.
        Object.defineProperty(app.config.globalProperties, '$p04dPorts', {
            value: Object.freeze({ ...injectedPorts }),
            writable: false,
            configurable: false,
            enumerable: true,
        });
    }
    const { EXPENSE_SOURCE_VALUES, DEFINITION_SOURCE_VALUES, MOTION_LEVEL_VALUES, toFiniteNumber, MAX_MONEY_INPUT, MONEY_DECIMAL_PATTERN, parseMoneyInput, roundMoney, normalizePersistedMoney, normalizeMotionLevel, toNonNegativeInteger, getMonthKey, toISODate, parseLocalCalendarDate, DEFAULT_PROFILE_OFFDAYS, TEMPLATE_APPLICABILITY_VALUES, getMonthBoundsFromDate, getPreviousMonthKey, isDateInRange, enumerateDateRange, normalizeWeekdayIndex, normalizeProfileOffdays, normalizeTemplateDays, getValidTemplateDays, hasValidMonthlySchedule, getDateWeekdayIndex, isProfileOffdayForDate, templateMatchesApplicabilityForDate, getMonthlyTemplateDays, templateOccursOnDate, compareExpensePriority, matchesTemplateFallbackShape, findTemplateExpenseMatch, buildTemplateExpenseFromDefinition, didTemplateExpenseRebuildChange, LEGACY_TEMPLATE_PROFILE, MONTH_START_PROMPT_DEFER_KEY, MONTH_END_PROMPT_DEFER_KEY, ONBOARDING_STATE_KEY, ONBOARDING_STATUS_VALUES, MONTH_END_SETTLEMENT_DECISIONS, normalizeTemplateProfileRecord, normalizeTemplateProfiles, getTemplateProfileRecordById, MONTH_KEY_PATTERN, normalizeMonthlyTemplateAssignmentRecord, normalizeMonthlyTemplateAssignments, normalizeMonthlyBaseAllowances, normalizeOnboardingStateRecord, normalizeVaultGoalRecord, normalizeVaultGoals, normalizeVaultTransactionRecord, normalizeVaultStateRecord, normalizeMonthEndSettlementRecord, normalizeMonthEndSettlements, getDefinitionProfileId, isDefinitionInProfile, normalizeDefinitionRecord, isFlexibleDefinitionRecord, toSerializableValue, getExpenseTemplateOriginId, getExpenseTemplateProtection, didExpenseStructureChange, normalizeExpenseRecord, BACKUP_EXPENSE_MONEY_FIELDS, isPlainObjectRecord, isValidBackupMoneyValue, isValidIsoDateString, isValidTimestampString, hasDuplicateRecordIds, validateBackupPayload, DB, Store } = dataRuntime;
    const { localStorage, document, navigator, alert, location, Blob, URL, FileReader, setTimeout, clearTimeout, window } = environment;

        /**
         * ================================================================
         * MODULE: MAIN CONTROLLER (Root Logic)
         * ================================================================
         * Wires the Store, Components, and View State together.
         */

        // Extend the App definition from Part 3
        const THEME_META_COLORS = {
            dark: '#09090b',
            light: '#f4f7fb'
        };

        const createAddModalForm = () => ({
            name: '',
            cost: '',
            category: 'food',
            recurrence: 'daily',
            applicability: 'everyday',
            monthDay: '',
            classification: 'essential',
            source: 'manual',
            flexibleDefinitionId: '',
            monthlyBudget: '',
            maxUsesPerMonth: ''
        });

        const createOnboardingTemplateDraft = (overrides = {}) => ({
            name: '',
            cost: '',
            category: 'food',
            // P1-06 review fix: a monthly recurrence must never silently start on
            // day 1; the day input starts empty and an explicit day is required.
            day: '',
            ...(overrides || {})
        });

        const createOnboardingModalState = () => ({
            open: false,
            step: 1,
            isLoading: false,
            budget: 1000,
            selectedProfileId: '',
            effectiveDate: '',
            source: 'startup',
            planMode: 'existing',
            newProfileName: '',
            offdays: [...DEFAULT_PROFILE_OFFDAYS],
            workdayItems: [],
            offdayItems: [],
            monthlyItems: [],
            workdayDraft: createOnboardingTemplateDraft(),
            offdayDraft: createOnboardingTemplateDraft(),
            monthlyDraft: createOnboardingTemplateDraft(),
        });

        app.mixin({
            data() {
                return {
                    lang: localStorage.getItem('rushd_lang') || 'ar',
                    calendarType: localStorage.getItem('rushd_calendar') || 'gregorian',
                    currentView: 'dashboard',
                    dateWindow: [],
                    toastMessage: '',
                    toastVisible: false,
                    onboardingState: null,

                    // Modal States
                    payModal: {
                        open: false,
                        item: null,
                        amount: '0',
                        autoCleared: false
                    },
                    addModal: {
                        open: false,
                        isSubmitting: false,
                        mode: 'expense',
                        form: createAddModalForm()
                    },
                    editModal: {
                        open: false,
                        item: null,
                        type: 'expense',
                        form: { name: '', cost: 0, category: 'food', date: '', recurrence: 'daily', applicability: 'everyday', classification: 'essential', profileId: LEGACY_TEMPLATE_PROFILE.id }
                    },
                    applyTemplatesModal: {
                        open: false,
                        mode: 'manual',
                        effectiveDate: '',
                        preview: null,
                        blockedPlan: null,
                        isLoading: false,
                        selectedProfileId: '',
                        promptMonthKey: ''
                    },
                    monthEndModal: {
                        open: false,
                        isLoading: false,
                        summary: null
                    },
                    onboardingModal: createOnboardingModalState(),
                    vaultGoalForm: {
                        name: '',
                        targetAmount: '',
                        allocatedAmount: ''
                    },

                    planSectionsOpen: {
                        workday: true,
                        offday: false,
                        monthly: false,
                        flexible: false
                    },

                    confirmDialog: {
                        open: false,
                        title: '',
                        message: '',
                        confirmText: '',
                        confirmColor: 'danger',
                        onConfirm: null
                    },

                    // Selection Mode
                    selectionMode: false,
                    selectedExpenseIds: [],
                    // D4: canonical availability for the Home hero. Independent
                    // of `budgetKnown` because starting funds are not a budget.
                    p04dSafeToSpend: null,

                    _toastTimer: null
                }
            },
            computed: {
                // i18n: reactive translations dictionary
                t() {
                    return TRANSLATIONS[this.lang] || TRANSLATIONS.ar;
                },
                // Motion v3.0: index of the active nav tab (0..4) for the sliding pill indicator.
                navActiveIndex() {
                    const order = ['dashboard', 'statistics', 'vault', 'plans', 'settings'];
                    const idx = order.indexOf(this.currentView);
                    return idx === -1 ? 0 : idx;
                },
                // Reactive category options using translations
                categoryOptions() {
                    return [
                        { id: 'transport', label: this.t.transport, icon: 'directions_car' },
                        { id: 'food', label: this.t.food, icon: 'restaurant' },
                        { id: 'utilities', label: this.t.utilities, icon: 'bolt' },
                        { id: 'tech', label: this.t.tech, icon: 'devices' },
                        { id: 'shopping', label: this.t.shopping, icon: 'shopping_bag' },
                        { id: 'other', label: this.t.other, icon: 'category' }
                    ];
                },
                templateProfiles() {
                    return normalizeTemplateProfiles(this.store.settings.templateProfiles);
                },
                currentTemplateProfile() {
                    return getTemplateProfileRecordById(this.store.settings.templateProfiles, this.store.settings.activeTemplateProfileId);
                },
                weekdayOptions() {
                    const referenceSunday = new Date(2024, 0, 7);
                    return Array.from({ length: 7 }, (_, index) => {
                        const day = new Date(referenceSunday);
                        day.setDate(referenceSunday.getDate() + index);
                        return {
                            value: index,
                            short: day.toLocaleDateString(this.t._locale, { weekday: 'short' })
                        };
                    });
                },
                templateApplicabilityOptions() {
                    return [
                        { value: 'everyday', label: this.t.everyday },
                        { value: 'workday', label: this.t.workday },
                        { value: 'offday', label: this.t.offday }
                    ];
                },
                onboardingModalTitle() {
                    return this.t.onboardingTitle;
                },
                applyTemplatesModalTitle() {
                    return this.applyTemplatesModal.mode === 'monthStart' ? this.t.monthStartPromptTitle : this.t.applyTemplates;
                },
                selectedOnboardingProfileId() {
                    const selectedProfileId = this.onboardingModal.selectedProfileId;
                    if (this.templateProfiles.some(profile => profile.id === selectedProfileId)) return selectedProfileId;
                    const activeProfileId = this.store.settings.activeTemplateProfileId;
                    if (this.templateProfiles.some(profile => profile.id === activeProfileId)) return activeProfileId;
                    return this.templateProfiles[0]?.id || '';
                },
                onboardingEffectiveDateMin() {
                    return getMonthBoundsFromDate(this.core.Date.getTodayISO()).monthStart;
                },
                onboardingEffectiveDateMax() {
                    return getMonthBoundsFromDate(this.core.Date.getTodayISO()).monthEnd;
                },
                onboardingEffectiveDateValid() {
                    if (!this.onboardingModal.effectiveDate) return false;
                    return getMonthKey(this.onboardingModal.effectiveDate) === getMonthKey(this.core.Date.getTodayISO());
                },
                onboardingBudgetValid() {
                    const rawValue = this.onboardingModal.budget;
                    if (rawValue === '' || rawValue === null || rawValue === undefined) return false;
                    const value = parseMoneyInput(rawValue);
                    return value !== null;
                },
                onboardingNewProfileNameNormalized() {
                    return String(this.onboardingModal.newProfileName || '').trim();
                },
                onboardingNewProfileNameTaken() {
                    const normalizedName = this.onboardingNewProfileNameNormalized.toLocaleLowerCase();
                    if (!normalizedName) return false;
                    return this.templateProfiles.some(profile => {
                        const normalizedProfile = normalizeTemplateProfileRecord(profile);
                        const storedName = (normalizedProfile?.name || '').toLocaleLowerCase();
                        const displayName = this.formatTemplateProfileName(profile).toLocaleLowerCase();
                        return storedName === normalizedName || displayName === normalizedName;
                    });
                },
                onboardingCanFinish() {
                    if (!this.onboardingBudgetValid || !this.onboardingEffectiveDateValid) return false;
                    if (this.onboardingModal.planMode === 'new') {
                        return !!this.onboardingNewProfileNameNormalized && !this.onboardingNewProfileNameTaken;
                    }
                    return !!this.selectedOnboardingProfileId;
                },
                // P1-06 review fix: the editor's day input must hold a valid
                // occurrence day before a monthly template can be saved.
                editModalMonthDayValid() {
                    if (this.editModal.type !== 'template') return true;
                    if (this.editModal.form?.recurrence !== 'monthly') return true;
                    const occurrenceDay = Math.floor(Number(this.editModal.form?.monthDay));
                    return Number.isInteger(occurrenceDay) && occurrenceDay >= 1 && occurrenceDay <= 31;
                },
                selectedApplyTemplatesProfileId() {
                    const selectedProfileId = this.applyTemplatesModal.selectedProfileId;
                    if (this.templateProfiles.some(profile => profile.id === selectedProfileId)) return selectedProfileId;
                    const activeProfileId = this.store.settings.activeTemplateProfileId;
                    if (this.templateProfiles.some(profile => profile.id === activeProfileId)) return activeProfileId;
                    return this.templateProfiles[0]?.id || '';
                },
                applyTemplatesEffectiveDateMin() {
                    if (this.applyTemplatesModal.mode !== 'monthStart' || !this.applyTemplatesModal.promptMonthKey) return '';
                    return getMonthBoundsFromDate(`${this.applyTemplatesModal.promptMonthKey}-01`).monthStart;
                },
                applyTemplatesEffectiveDateMax() {
                    if (this.applyTemplatesModal.mode !== 'monthStart' || !this.applyTemplatesModal.promptMonthKey) return '';
                    return getMonthBoundsFromDate(`${this.applyTemplatesModal.promptMonthKey}-01`).monthEnd;
                },
                applyTemplatesEffectiveDateValid() {
                    if (!this.applyTemplatesModal.effectiveDate) return false;
                    if (this.applyTemplatesModal.mode !== 'monthStart' || !this.applyTemplatesModal.promptMonthKey) return true;
                    return getMonthKey(this.applyTemplatesModal.effectiveDate) === this.applyTemplatesModal.promptMonthKey;
                },
                currentMonthTemplateAssignment() {
                    return this.store.getMonthlyTemplateAssignment(this.store.currentDate);
                },
                currentMonthAssignedTemplateProfileLabel() {
                    const profileId = this.currentMonthTemplateAssignment?.assignedProfileId || '';
                    if (!profileId) return '';
                    const profile = this.templateProfiles.find(item => item.id === profileId) || { id: profileId, name: profileId };
                    return this.formatTemplateProfileName(profile);
                },
                standardTemplates() {
                    return this.store.templates.filter(template => !isFlexibleDefinitionRecord(template) && isDefinitionInProfile(template, this.store.settings.activeTemplateProfileId));
                },
                planWorkdayTemplates() {
                    return this.standardTemplates.filter(t => {
                        const n = normalizeDefinitionRecord(t);
                        return n.recurrence === 'daily' && (n.applicability === 'workday' || n.applicability === 'everyday');
                    });
                },
                planOffdayTemplates() {
                    return this.standardTemplates.filter(t => {
                        const n = normalizeDefinitionRecord(t);
                        return n.recurrence === 'daily' && (n.applicability === 'offday' || n.applicability === 'everyday');
                    });
                },
                planMonthlyTemplates() {
                    return this.standardTemplates.filter(t => normalizeDefinitionRecord(t).recurrence === 'monthly');
                },
                planStructureSummary() {
                    const workday = this.standardTemplates.filter(t => { const n = normalizeDefinitionRecord(t); return n.recurrence === 'daily' && n.applicability === 'workday'; }).length;
                    const offday = this.standardTemplates.filter(t => { const n = normalizeDefinitionRecord(t); return n.recurrence === 'daily' && n.applicability === 'offday'; }).length;
                    const everyday = this.standardTemplates.filter(t => { const n = normalizeDefinitionRecord(t); return n.recurrence === 'daily' && n.applicability === 'everyday'; }).length;
                    const monthly = this.standardTemplates.filter(t => normalizeDefinitionRecord(t).recurrence === 'monthly').length;
                    return {
                        workday: workday + everyday,
                        offday: offday + everyday,
                        monthly,
                        flexible: this.flexibleDefinitions.length
                    };
                },
                planIsAssignedThisMonth() {
                    return !!this.currentMonthTemplateAssignment?.assignedProfileId;
                },
                flexibleDefinitions() {
                    return this.store.templates
                        .filter(template => isFlexibleDefinitionRecord(template) && isDefinitionInProfile(template, this.store.settings.activeTemplateProfileId))
                        .map(template => normalizeDefinitionRecord(template));
                },
                vaultTransactions() {
                    return this.store.settings.vault.transactions;
                },
                vaultGoals() {
                    return Array.isArray(this.store.settings.vault.goals) ? this.store.settings.vault.goals : [];
                },
                vaultGoalsWithProgress() {
                    return this.vaultGoals.map(goal => {
                        const targetAmount = Math.max(0, toFiniteNumber(goal.targetAmount, 0));
                        const progressAmount = Math.min(Math.max(0, toFiniteNumber(goal.allocatedAmount, 0)), targetAmount);
                        const progressPercentage = targetAmount > 0 ? Math.min(100, (progressAmount / targetAmount) * 100) : 0;
                        return {
                            ...goal,
                            targetAmount,
                            progressAmount,
                            progressPercentage
                        };
                    });
                },
                vaultGoalFormValid() {
                    const targetAmount = parseMoneyInput(this.vaultGoalForm.targetAmount);
                    const rawAllocation = this.vaultGoalForm.allocatedAmount;
                    const allocatedAmount = rawAllocation === '' || rawAllocation === null ? 0 : parseMoneyInput(rawAllocation);
                    return !!(typeof this.vaultGoalForm.name === 'string' && this.vaultGoalForm.name.trim())
                        && targetAmount !== null && targetAmount > 0
                        && allocatedAmount !== null
                        && allocatedAmount <= targetAmount
                        && this.vaultUnallocatedBalance >= allocatedAmount;
                },
                vaultUnallocatedBalance() {
                    const balance = Math.max(0, toFiniteNumber(this.store.settings.vault.balance, 0));
                    return Math.max(0, balance - this.vaultGoals.reduce(
                        (sum, goal) => sum + Math.max(0, toFiniteNumber(goal.allocatedAmount, 0)),
                        0
                    ));
                },
                vaultInsight() {
                    const balance = Math.max(0, toFiniteNumber(this.store.settings.vault.balance, 0));
                    const goals = this.vaultGoalsWithProgress;
                    const txCount = this.vaultTransactions.length;
                    // Find closest incomplete goal
                    let closestGoal = null;
                    let closestRemaining = Infinity;
                    for (const g of goals) {
                        if (g.progressPercentage >= 100) continue;
                        const remaining = g.targetAmount - g.progressAmount;
                        if (remaining < closestRemaining) {
                            closestRemaining = remaining;
                            closestGoal = g;
                        }
                    }
                    if (closestGoal) {
                        return {
                            type: 'close',
                            text: this.t.vaultInsightClose
                                .replace('{name}', closestGoal.name)
                                .replace('{amount}', this.formatCompactAmount(closestRemaining))
                        };
                    }
                    if (txCount > 0) {
                        return {
                            type: 'transfers',
                            text: this.t.vaultInsightTransfers.replace('{count}', txCount)
                        };
                    }
                    return null;
                },
                flexibleStatsById() {
                    return this.store.flexibleStats.items.reduce((lookup, item) => {
                        lookup[item.id] = item;
                        return lookup;
                    }, {});
                },
                flexibleDefinitionStatsList() {
                    return this.flexibleDefinitions.map(definition => {
                        const stats = this.flexibleStatsById[definition.id] || null;
                        return {
                            ...definition,
                            usedBudget: stats ? stats.usedBudget : 0,
                            uses: stats ? stats.uses : 0,
                            remainingBudget: stats ? stats.remainingBudget : definition.monthlyBudget,
                            remainingUses: stats ? stats.remainingUses : definition.maxUsesPerMonth
                        };
                    });
                },
                selectedFlexibleDefinition() {
                    return this.flexibleDefinitions.find(item => item.id === this.addModal.form.flexibleDefinitionId) || null;
                },
                sortedExpenses() {
                    return [...this.store.currentViewExpenses].sort((a, b) => {
                        if (a.isPaid === b.isPaid) return 0;
                        return a.isPaid ? 1 : -1;
                    });
                },
                selectedPaidCount() {
                    if (!this.selectionMode || this.selectedExpenseIds.length === 0) return 0;
                    return this.store.currentViewExpenses.filter(e => this.selectedExpenseIds.includes(e.id) && e.isPaid).length;
                },
                currentMonthYear() {
                    const d = this.core.Date.parseLocalDate(this.store.currentDate);
                    if (this.calendarType === 'hijri') {
                        let str = d.toLocaleDateString(this.t._locale, { calendar: 'islamic', month: 'long', year: 'numeric' });
                        // Remove trailing "AH" suffix for English locale
                        if (this.lang === 'en') str = str.replace(/\s*AH$/i, '');
                        return str;
                    }
                    // Explicit Gregorian prevents ar-SA from silently falling back to Hijri
                    return d.toLocaleDateString(this.t._locale, { calendar: 'gregory', month: 'long', year: 'numeric' });
                },
                dailyExpectedTotal() {
                    return this.store.currentViewExpenses.reduce((sum, e) => sum + (e.expectedCost || 0), 0);
                },
                dailyPaidTotal() {
                    return this.store.currentViewExpenses
                        .filter(e => e.isPaid)
                        .reduce((sum, e) => sum + (e.actualPaid || 0), 0);
                },
                monthEndHasPositiveSurplus() {
                    return toFiniteNumber(this.monthEndModal.summary?.surplus, 0) > 0;
                },
                anyModalOpen() {
                    return this.payModal.open || this.addModal.open || this.editModal.open || this.applyTemplatesModal.open || this.monthEndModal.open || this.onboardingModal.open || this.confirmDialog.open;
                },
                currentShellTitle() {
                    return this.currentView === 'statistics'
                        ? this.t.statistics
                        : this.currentView === 'vault'
                            ? this.t.vault
                            : this.currentView === 'plans'
                                ? this.t.plans
                                : this.t.settings;
                },
                displaySafeToSpend() {
                    // P1-05: the divide-by-four weekly pace was not trustworthy and is
                    // disabled. Deterministic pacing belongs to the Insights phase,
                    // so Rushd only shows the monthly amount it can actually compute.
                    // D4: canonical availability is independent of budgetKnown.
                    if (p04dIsCandidate()) return this.p04dSafeToSpend;
                    return this.store.safeToSpend;
                },
                // P04-D3 candidate affordances: false in legacy mode, so the
                // established visuals and behavior stay exactly as before.
                p04dCandidateActive() {
                    return p04dIsCandidate();
                },
                p04dAddSubmitBlocked() {
                    if (!p04dIsCandidate()) return false;
                    if (!p04dIsWritable()) return true;
                    return this.addModal.mode === 'template' || this.addModal.mode === 'flexibleDefinition' || this.addModal.form.source === 'flexible';
                },
                isArabicText() {
                    const arRegex = /[\u0600-\u06FF]/;
                    return (text) => arRegex.test(text);
                }
            },
            watch: {
                'store.currentDate': {
                    handler(newVal) {
                        if (this.isRoot) this.centerDateScroller(newVal);
                    }
                },
                currentView(newView) {
                    if (newView === 'dashboard') {
                        setTimeout(() => this.centerDateScroller(this.store.currentDate, 'instant'), 350);
                    }
                },
                // Regenerate date window when language changes (for locale-aware day/month names)
                lang() {
                    const today = this.core.Date.getTodayISO();
                    this.dateWindow = this.core.Date.generateWindow(today, 60, 60, this.t._locale, this.calendarType);
                    this.$nextTick(() => this.centerDateScroller(this.store.currentDate, 'instant'));
                },
                calendarType() {
                    const today = this.core.Date.getTodayISO();
                    this.dateWindow = this.core.Date.generateWindow(today, 60, 60, this.t._locale, this.calendarType);
                    this.$nextTick(() => this.centerDateScroller(this.store.currentDate, 'instant'));
                },
                anyModalOpen() {
                    this.$nextTick(() => {
                        const fab = this.$refs.fabBtn;
                        if (!fab) return;
                        fab.style.filter = '';
                    });
                }
            },
            methods: {
                // --- INITIALIZATION ---
                navigateTo(view) {
                    const targetView = ['dashboard', 'statistics', 'vault', 'plans', 'settings'].includes(view) ? view : 'dashboard';
                    if (targetView !== 'dashboard' && this.selectionMode) {
                        this.exitSelectionMode();
                    }
                    this.currentView = targetView;
                    // P04-D4: the visible route intent persists through the
                    // navigation port (UI chrome only) so refresh and
                    // offline recovery restore the destination.
                    if (p04dIsCandidate()) p04dPersistNavIntent(this);
                },
                async persistOnboardingState(status, source = '') {
                    // P04-D4: onboarding status is local flow state and
                    // persists through the lifecycle port in candidate mode,
                    // never the v1 settings store.
                    if (p04dIsCandidate()) {
                        // D4 correction: on port failure the prior flow
                        // state stands — never assign or return a fabricated
                        // success record.
                        const previous = this.onboardingState ?? null;
                        try {
                            const next = await p04dCandidatePorts.lifecycle.persistOnboardingState(status, source);
                            this.onboardingState = next;
                            return next;
                        } catch {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                            this.onboardingState = previous;
                            return previous;
                        }
                    }
                    const nextState = {
                        status,
                        updatedAt: new Date().toISOString(),
                        source: typeof source === 'string' ? source : ''
                    };
                    this.onboardingState = nextState;
                    await DB.setSetting(ONBOARDING_STATE_KEY, nextState);
                    return nextState;
                },
                async resolveOnboardingStatus() {
                    // P04-D4: migration implies setup is done; the port's
                    // local flow status answers when present, otherwise the
                    // migrated book counts as completed. Never reads v1.
                    // P04-D5: neither answer may claim completion while no
                    // usable canonical book exists (post-reset recovery):
                    // without a book the scope is pending, never completed.
                    // D5 round-2: fail closed — a missing method or read
                    // error counts as no book, never as completion.
                    if (p04dIsCandidate()) {
                        let usableBook = false;
                        try {
                            usableBook = typeof p04dCandidatePorts.lifecycle.hasUsableBook === 'function'
                                ? p04dCandidatePorts.lifecycle.hasUsableBook() === true
                                : false;
                        } catch {
                            usableBook = false;
                        }
                        if (!usableBook) {
                            this.onboardingState = { status: 'pending', updatedAt: '', source: 'no-book' };
                            return 'pending';
                        }
                        try {
                            const stored = p04dCandidatePorts.lifecycle.getOnboardingState();
                            if (stored) {
                                this.onboardingState = stored;
                                return stored.status;
                            }
                        } catch {
                            /* a failed read counts as completed below */
                        }
                        this.onboardingState = { status: 'completed', updatedAt: '', source: 'migration' };
                        return 'completed';
                    }
                    const storedState = normalizeOnboardingStateRecord(await DB.getSetting(ONBOARDING_STATE_KEY, null));
                    if (storedState) {
                        this.onboardingState = storedState;
                        return storedState.status;
                    }

                    const hasExistingExpenses = (await DB.getAllExpenses()).length > 0;
                    const hasTemplates = this.store.templates.length > 0;
                    const hasAssignments = this.store.settings.monthlyTemplateAssignments.length > 0;
                    const hasNonDefaultBudget = toFiniteNumber(this.store.settings.baseAllowance, 1000) !== 1000;
                    const normalizedProfiles = normalizeTemplateProfiles(this.store.settings.templateProfiles);
                    const hasProfileChanges = this.store.settings.activeTemplateProfileId !== LEGACY_TEMPLATE_PROFILE.id
                        || normalizedProfiles.some(profile => profile.id !== LEGACY_TEMPLATE_PROFILE.id);

                    if (hasExistingExpenses || hasTemplates || hasAssignments || hasNonDefaultBudget || hasProfileChanges) {
                        await this.persistOnboardingState('completed', 'existing-data');
                        return 'completed';
                    }

                    this.onboardingState = { status: 'pending', updatedAt: '', source: '' };
                    return 'pending';
                },
                openOnboardingModal(options = {}) {
                    // P04-D4: the setup modal stages v1 profiles, templates,
                    // and plan applications; it never opens in candidate
                    // mode (see reopenOnboardingFromSettings).
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'onboarding'));
                        return;
                    }
                    const today = this.core.Date.getTodayISO();
                    const effectiveDate = typeof options?.effectiveDate === 'string' && getMonthKey(options.effectiveDate) === getMonthKey(today)
                        ? options.effectiveDate
                        : today;
                    const resolvedProfileId = this.templateProfiles.some(profile => profile.id === options?.profileId)
                        ? options.profileId
                        : (this.templateProfiles.some(profile => profile.id === this.store.settings.activeTemplateProfileId)
                            ? this.store.settings.activeTemplateProfileId
                            : (this.templateProfiles[0]?.id || ''));
                    const resolvedProfile = this.templateProfiles.find(profile => profile.id === resolvedProfileId) || LEGACY_TEMPLATE_PROFILE;

                    this.onboardingModal = {
                        ...createOnboardingModalState(),
                        open: true,
                        step: 1,
                        isLoading: false,
                        budget: toFiniteNumber(this.store.settings.baseAllowance, 1000),
                        selectedProfileId: resolvedProfileId,
                        effectiveDate,
                        source: options?.source === 'settings' ? 'settings' : 'startup',
                        planMode: 'existing',
                        offdays: [...normalizeProfileOffdays(resolvedProfile.offdays)]
                    };
                    const templateItems = this.getOnboardingTemplateItemsForProfile(resolvedProfile.id);
                    this.onboardingModal.workdayItems = templateItems.workdayItems;
                    this.onboardingModal.offdayItems = templateItems.offdayItems;
                    this.onboardingModal.monthlyItems = templateItems.monthlyItems;
                },
                async handleOnboardingModalVisibilityChange(nextValue) {
                    // P04-D4: onboarding never opens in candidate mode (see
                    // initApp); a close here never writes v1 state.
                    if (p04dIsCandidate()) {
                        this.onboardingModal.open = false;
                        return;
                    }
                    if (nextValue) {
                        this.onboardingModal.open = true;
                        return;
                    }
                    await this.skipOnboardingForNow();
                },
                continueOnboarding() {
                    if (!this.onboardingBudgetValid) return;
                    this.onboardingModal.step = 2;
                },
                getOnboardingTemplateItemsForProfile(profileId) {
                    const templates = this.store.templates
                        .filter(template => !isFlexibleDefinitionRecord(template) && isDefinitionInProfile(template, profileId))
                        .map(template => normalizeDefinitionRecord(template));

                    return {
                        workdayItems: templates.filter(template => template.recurrence === 'daily' && template.applicability === 'workday'),
                        offdayItems: templates.filter(template => template.recurrence === 'daily' && template.applicability === 'offday'),
                        // P1-06 review fix: show only the genuinely stored valid days —
                        // a legacy monthly template without a day stays visibly dayless.
                        monthlyItems: templates.filter(template => template.recurrence === 'monthly')
                            .map(template => ({
                                ...template,
                                days: getValidTemplateDays(template)
                            }))
                    };
                },
                loadOnboardingPlanContents(profileId) {
                    const selectedProfile = this.templateProfiles.find(profile => profile.id === profileId) || LEGACY_TEMPLATE_PROFILE;
                    const templateItems = this.getOnboardingTemplateItemsForProfile(selectedProfile.id);
                    this.onboardingModal.selectedProfileId = selectedProfile.id;
                    this.onboardingModal.offdays = [...normalizeProfileOffdays(selectedProfile.offdays)];
                    this.onboardingModal.workdayItems = templateItems.workdayItems;
                    this.onboardingModal.offdayItems = templateItems.offdayItems;
                    this.onboardingModal.monthlyItems = templateItems.monthlyItems;
                },
                setOnboardingPlanMode(mode) {
                    this.onboardingModal.planMode = mode === 'new' ? 'new' : 'existing';
                    if (this.onboardingModal.planMode === 'new') {
                        this.onboardingModal.offdays = [...DEFAULT_PROFILE_OFFDAYS];
                        this.onboardingModal.workdayItems = [];
                        this.onboardingModal.offdayItems = [];
                        this.onboardingModal.monthlyItems = [];
                        return;
                    }
                    this.loadOnboardingPlanContents(this.selectedOnboardingProfileId || LEGACY_TEMPLATE_PROFILE.id);
                },
                selectOnboardingProfile(profileId) {
                    if (!this.templateProfiles.some(profile => profile.id === profileId)) return;
                    this.onboardingModal.planMode = 'existing';
                    this.loadOnboardingPlanContents(profileId);
                },
                toggleOnboardingOffday(dayIndex) {
                    const normalizedDayIndex = normalizeWeekdayIndex(dayIndex);
                    if (normalizedDayIndex === null) return;
                    const nextOffdays = this.onboardingModal.offdays.includes(normalizedDayIndex)
                        ? this.onboardingModal.offdays.filter(value => value !== normalizedDayIndex)
                        : [...this.onboardingModal.offdays, normalizedDayIndex];
                    this.onboardingModal.offdays = normalizeProfileOffdays(nextOffdays);
                },
                addOnboardingTemplateItem(section) {
                    const sectionConfig = {
                        workday: { itemsKey: 'workdayItems', draftKey: 'workdayDraft', recurrence: 'daily', applicability: 'workday' },
                        offday: { itemsKey: 'offdayItems', draftKey: 'offdayDraft', recurrence: 'daily', applicability: 'offday' },
                        monthly: { itemsKey: 'monthlyItems', draftKey: 'monthlyDraft', recurrence: 'monthly', applicability: 'everyday' }
                    }[section];
                    if (!sectionConfig) return;

                    const draft = this.onboardingModal[sectionConfig.draftKey];
                    const name = String(draft?.name || '').trim();
                    if (!name) return;
                    const expectedCost = parseMoneyInput(draft?.cost);
                    if (expectedCost === null) {
                        this.showToast(this.t.invalidMoneyInput);
                        return;
                    }

                    const baseItem = {
                        id: this.core.UUID(),
                        name,
                        expectedCost,
                        category: draft?.category || 'food',
                        recurrence: sectionConfig.recurrence,
                        applicability: sectionConfig.applicability
                    };

                    // P1-06 review fix: a monthly item needs an explicit valid day;
                    // nothing is added until one is chosen.
                    let item;
                    if (section === 'monthly') {
                        const occurrenceDay = Math.floor(Number(draft?.day));
                        if (!Number.isInteger(occurrenceDay) || occurrenceDay < 1 || occurrenceDay > 31) {
                            this.showToast(this.t.monthlyDayRequired);
                            return;
                        }
                        item = { ...baseItem, days: [occurrenceDay] };
                    } else {
                        item = baseItem;
                    }

                    this.onboardingModal[sectionConfig.itemsKey] = [...this.onboardingModal[sectionConfig.itemsKey], item];
                    this.onboardingModal[sectionConfig.draftKey] = createOnboardingTemplateDraft();
                },
                removeOnboardingTemplateItem(section, itemId) {
                    const itemsKey = section === 'workday'
                        ? 'workdayItems'
                        : section === 'offday'
                            ? 'offdayItems'
                            : section === 'monthly'
                                ? 'monthlyItems'
                                : '';
                    if (!itemsKey) return;
                    this.onboardingModal[itemsKey] = this.onboardingModal[itemsKey].filter(item => item.id !== itemId);
                },
                async                 resolveOnboardingTargetProfileId() {
                    // P04-D4: onboarding profiles have no canonical
                    // counterpart; see finishOnboarding.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'onboarding'));
                        return '';
                    }
                    if (this.onboardingModal.planMode === 'new') {
                        const name = this.onboardingNewProfileNameNormalized;
                        if (!name) {
                            alert(this.t.profileNameRequired);
                            return '';
                        }
                        if (this.onboardingNewProfileNameTaken) {
                            alert(this.t.profileNameExists);
                            return '';
                        }

                        const profile = {
                            id: this.core.UUID(),
                            name,
                            offdays: normalizeProfileOffdays(this.onboardingModal.offdays)
                        };

                        this.store.settings.templateProfiles = normalizeTemplateProfiles([...this.templateProfiles, profile]);
                        await DB.setSetting('templateProfiles', this.store.settings.templateProfiles);
                        this.onboardingModal.selectedProfileId = profile.id;
                        return profile.id;
                    }

                    const targetProfileId = this.selectedOnboardingProfileId;
                    if (!targetProfileId) return '';

                    this.store.settings.templateProfiles = normalizeTemplateProfiles(this.templateProfiles.map(profile => {
                        const normalizedProfile = normalizeTemplateProfileRecord(profile);
                        if (!normalizedProfile || normalizedProfile.id !== targetProfileId) return profile;
                        return {
                            ...normalizedProfile,
                            offdays: normalizeProfileOffdays(this.onboardingModal.offdays)
                        };
                    }));
                    await DB.setSetting('templateProfiles', this.store.settings.templateProfiles);
                    return targetProfileId;
                },
                async                 persistOnboardingTemplateItems(profileId) {
                    // P04-D4: onboarding plan staging writes v1 templates;
                    // without a canonical profile counterpart this stays
                    // visibly blocked instead of writing v1.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'onboarding'));
                        return;
                    }
                    const existingScopedTemplates = this.store.templates
                        .filter(template => !isFlexibleDefinitionRecord(template) && isDefinitionInProfile(template, profileId))
                        .map(template => normalizeDefinitionRecord(template))
                        .filter(template => template.recurrence === 'monthly' || (template.recurrence === 'daily' && ['workday', 'offday'].includes(template.applicability)));
                    const stagedTemplates = [
                        ...this.onboardingModal.workdayItems,
                        ...this.onboardingModal.offdayItems,
                        ...this.onboardingModal.monthlyItems
                    ].map(template => normalizeDefinitionRecord({
                        ...template,
                        id: template.id || this.core.UUID(),
                        source: 'template',
                        profileId,
                        recurrence: template.recurrence === 'monthly' ? 'monthly' : 'daily',
                        applicability: template.recurrence === 'monthly' ? 'everyday' : (template.applicability || 'everyday'),
                        // P1-06 review fix: persist only the valid days that were
                        // explicitly chosen; no day is ever invented here.
                        days: template.recurrence === 'monthly' ? getValidTemplateDays(template) : []
                    }));

                    const stagedTemplateIds = new Set(stagedTemplates.map(template => template.id));
                    const scopedTemplateIdsToDelete = existingScopedTemplates
                        .filter(template => !stagedTemplateIds.has(template.id))
                        .map(template => template.id);

                    for (const templateId of scopedTemplateIdsToDelete) {
                        await DB.deleteTemplate(templateId);
                    }

                    for (const template of stagedTemplates) {
                        await DB.saveTemplate(JSON.parse(JSON.stringify(template)));
                    }

                    const deletedTemplateIds = new Set(scopedTemplateIdsToDelete);
                    this.store.templates = [
                        ...this.store.templates.filter(template => !deletedTemplateIds.has(template.id) && !stagedTemplateIds.has(template.id)),
                        ...stagedTemplates
                    ];
                },
                async skipOnboardingForNow() {
                    if (this.onboardingState?.status !== 'completed') {
                        await this.persistOnboardingState('skipped', this.onboardingModal.source === 'settings' ? 'settings-skip' : 'first-run-skip');
                    }
                    this.onboardingModal.open = false;
                },
                async finishOnboarding() {
                    // P04-D4: onboarding setup (budget, profiles, templates,
                    // plan application) has no canonical path: profiles have
                    // no counterpart and the allowance is read-only history.
                    // The migrated book needs no setup, so this stays
                    // visibly blocked instead of writing v1.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'onboarding'));
                        return;
                    }
                    if (!this.onboardingCanFinish) return;
                    // P1-06 review fix: a monthly item without a valid day (including
                    // a legacy template kept in the plan) blocks setup before ANY
                    // write happens — no profile, no settings, no plan application.
                    const invalidStagedMonthly = this.onboardingModal.monthlyItems
                        .filter(item => item.recurrence === 'monthly' && !hasValidMonthlySchedule(item));
                    if (invalidStagedMonthly.length > 0) {
                        this.showToast(this.t.onboardingBlockedMonthlyDay.replace('{name}', invalidStagedMonthly[0].name || invalidStagedMonthly[0].id || ''));
                        return;
                    }
                    this.onboardingModal.isLoading = true;
                    try {
                        const safeBudgetValue = parseMoneyInput(this.onboardingModal.budget);
                        if (safeBudgetValue === null) {
                            this.showToast(this.t.invalidMoneyInput);
                            return;
                        }
                        const targetProfileId = await this.resolveOnboardingTargetProfileId();
                        if (!targetProfileId) return;
                        this.store.settings.baseAllowance = safeBudgetValue;
                        await DB.setSetting('baseAllowance', safeBudgetValue);
                        await this.store.recordCurrentMonthBaseAllowance();
                        await this.persistOnboardingTemplateItems(targetProfileId);
                        await this.setActiveTemplateProfile(targetProfileId);
                        await this.store.applyTemplatesFrom(this.onboardingModal.effectiveDate, { profileId: targetProfileId });
                        await this.persistOnboardingState('completed', 'finished');
                        this.clearMonthStartPromptDeferral();
                        this.onboardingModal.open = false;
                        this.showToast(this.t.onboardingDone);
                    } finally {
                        this.onboardingModal.isLoading = false;
                    }
                },
                reopenOnboardingFromSettings() {
                    // P04-D4: setup is complete after migration; reopening
                    // onboarding would stage v1 profiles and templates, so it
                    // stays visibly blocked in candidate mode.
                    // P04-D5 round-2: the completion claim is gated on a
                    // usable book and fails closed. Without one the user is
                    // told to reload (boot re-provisions the book); the
                    // existing blocked copy is reused, no new screens.
                    if (p04dIsCandidate()) {
                        let usableBook = false;
                        try {
                            usableBook = typeof p04dCandidatePorts.lifecycle.hasUsableBook === 'function'
                                ? p04dCandidatePorts.lifecycle.hasUsableBook() === true
                                : false;
                        } catch {
                            usableBook = false;
                        }
                        this.showToast(p04dBlockedCopy(this.lang, usableBook ? 'onboarding' : 'authority'));
                        return;
                    }
                    this.openOnboardingModal({
                        source: 'settings',
                        effectiveDate: this.core.Date.getTodayISO(),
                        profileId: this.store.settings.activeTemplateProfileId
                    });
                },
                async initApp() {
                    if (!this.isRoot) return;

                    // P04-D3: candidate mode keeps the established shell
                    // mounted on committed canonical state. Onboarding and
                    // month-end v1 flows stay out; theme/motion/date chrome
                    // behaves exactly as in legacy.
                    // P04-D4: settings chrome and the route/date intent come
                    // from canonical ports; Plan/Insights/Goals mirrors keep
                    // the populated destinations useful.
                    if (p04dIsCandidate()) {
                        this.applyLangDirection();
                        try {
                            await p04dCandidatePorts.lifecycle.initialize();
                        } catch {
                            /* the shell mounts on the last committed state */
                        }
                        await syncP04DCandidateSettings(this);
                        this.applyTheme(this.store.settings.theme, false);
                        this.applyMotionProfile(this.store.settings.motionLevel, false);
                        const candidateToday = this.core.Date.getTodayISO();
                        const candidateLocale = this.t._locale;
                        this.dateWindow = this.core.Date.generateWindow(candidateToday, 60, 60, candidateLocale, this.calendarType);
                        try {
                            const restored = p04dCandidatePorts.navigation.restoreIntent();
                            if (restored && restored.view) {
                                if (restored.date) {
                                    try {
                                        await p04dCandidatePorts.home.selectDate(restored.date);
                                    } catch {
                                        /* the current day stays on read failure */
                                    }
                                }
                                this.navigateTo(restored.view);
                            }
                        } catch {
                            /* the default destination stays on restore failure */
                        }
                        await syncP04DCandidateHome(this);
                        await syncP04DCandidatePlan(this);
                        await syncP04DCandidateInsights(this);
                        await syncP04DCandidateGoals(this);
                        // P04-D5 round-2: the candidate shell never claims a
                        // usable setup without a usable book. Boot already
                        // provisions one; when that failed, stay pending and
                        // say so with the existing blocked copy (a reload
                        // retries provisioning). Fail closed on read errors.
                        try {
                            const usable = typeof p04dCandidatePorts.lifecycle.hasUsableBook === 'function'
                                ? p04dCandidatePorts.lifecycle.hasUsableBook() === true
                                : false;
                            this.onboardingState = usable
                                ? this.onboardingState
                                : { status: 'pending', updatedAt: '', source: 'no-book' };
                            if (!usable) this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                        } catch {
                            this.onboardingState = { status: 'pending', updatedAt: '', source: 'no-book' };
                        }
                        p04dPersistNavIntent(this);
                        this.$nextTick(() => this.centerDateScroller(this.store.currentDate, 'instant'));
                        return;
                    }

                    // Apply language direction
                    this.applyLangDirection();

                    await this.store.init();
                    this.applyTheme(this.store.settings.theme);
                    this.applyMotionProfile(this.store.settings.motionLevel);
                    const today = this.core.Date.getTodayISO();
                    const locale = this.t._locale;
                    this.dateWindow = this.core.Date.generateWindow(today, 60, 60, locale, this.calendarType);
                    this.$nextTick(() => this.centerDateScroller(this.store.currentDate, 'instant'));

                    // Check for import success flag
                    if (localStorage.getItem('rushd_import_success') || localStorage.getItem('microsave_import_success')) {
                        localStorage.removeItem('rushd_import_success');
                        localStorage.removeItem('microsave_import_success');
                        this.showToast(this.t.importSuccess);
                    }

                    const onboardingStatus = await this.resolveOnboardingStatus();
                    if (onboardingStatus === 'pending') {
                        this.openOnboardingModal({
                            source: 'startup',
                            effectiveDate: today,
                            profileId: this.store.settings.activeTemplateProfileId
                        });
                        return;
                    }

                    if (onboardingStatus === 'skipped') {
                        return;
                    }

                    const monthEndPromptOpened = await this.maybeHandleMonthEndDecision(today);
                    if (monthEndPromptOpened) {
                        return;
                    }

                    this.maybeOpenMonthStartPrompt(today);
                },

                // --- NAVIGATION ---
                async selectDate(iso) {
                    // P04-D3: the selected day, its rows, and totals come
                    // from committed canonical state in candidate mode.
                    if (p04dIsCandidate()) {
                        if (this.selectionMode) this.exitSelectionMode();
                        try {
                            await p04dCandidatePorts.home.selectDate(iso);
                        } catch {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                        }
                        await syncP04DCandidateHome(this);
                        this.centerDateScroller(this.store.currentDate);
                        p04dPersistNavIntent(this);
                        return;
                    }
                    if (this.selectionMode) this.exitSelectionMode();
                    this.store.loadDay(iso);
                },
                centerDateScroller(iso, behavior = 'smooth') {
                    // Retry up to 10 times with 150ms intervals (handles v-if transition delays)
                    let attempts = 0;
                    const tryScroll = () => {
                        const el = this.$refs.dateScroller;
                        if (!el) {
                            if (++attempts < 10) setTimeout(tryScroll, 150);
                            return;
                        }
                        // Find target by data attribute or .active class
                        const target = el.querySelector('.active') || el.querySelector(`[data-iso="${iso}"]`);
                        if (target) {
                            el.scrollTo({
                                left: target.offsetLeft - (el.clientWidth / 2) + (target.clientWidth / 2),
                                behavior: behavior
                            });
                        } else if (++attempts < 10) {
                            setTimeout(tryScroll, 150);
                        }
                    };
                    this.$nextTick(tryScroll);
                },

                // --- DATA ACTIONS ---
                // P1-11: the always-false hasPending activity dot placeholder was
                // removed; real per-day activity indicators belong to the Insights
                // phase and must be computed from actual data.

                async autoFillToday() {
                    // P04-D3: template generation has no canonical owner
                    // yet; it stays visibly blocked and never reaches v1.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'autofill'));
                        return;
                    }
                    const dateStr = this.store.currentDate;
                    // P1-07 review fix: historical Auto-Fill is visibly blocked — the
                    // rules that were in effect back then are not preserved, so Rushd
                    // must not generate historical activity from today's edited rules.
                    if (dateStr && dateStr < this.core.Date.getTodayISO()) {
                        this.showToast(this.t.historicalAutoFillBlocked);
                        return;
                    }
                    // P1-06 review fix: a monthly template without a schedule day
                    // blocks generation visibly instead of silently doing nothing.
                    const blockedMonthly = this.store.getInvalidMonthlyScheduleTemplates(
                        this.store.resolveTemplateProfileIdForDate(dateStr)
                    );
                    if (blockedMonthly.length > 0) {
                        this.showToast(this.t.autoFillBlockedMonthlyDay.replace('{name}', blockedMonthly[0].name || blockedMonthly[0].id));
                        return;
                    }
                    await this.store.autoFillDay(dateStr);
                },

                getMonthStartPromptDeferral() {
                    // P04-D4: deferral reads come from the lifecycle port in
                    // candidate mode, never raw storage.
                    if (p04dIsCandidate()) {
                        try {
                            return p04dCandidatePorts.lifecycle.getMonthStartDeferral();
                        } catch {
                            return null;
                        }
                    }
                    try {
                        const parsed = JSON.parse(localStorage.getItem(MONTH_START_PROMPT_DEFER_KEY) || 'null');
                        if (!parsed || typeof parsed !== 'object') return null;
                        const monthKey = typeof parsed.monthKey === 'string' ? parsed.monthKey : '';
                        const dateStr = typeof parsed.dateStr === 'string' ? parsed.dateStr : '';
                        if (!MONTH_KEY_PATTERN.test(monthKey) || !dateStr) return null;
                        return { monthKey, dateStr };
                    } catch (error) {
                        return null;
                    }
                },
                clearMonthStartPromptDeferral() {
                    // P04-D4: deferral removal routes through the lifecycle
                    // port in candidate mode, never raw storage.
                    if (p04dIsCandidate()) {
                        try {
                            p04dCandidatePorts.lifecycle.clearMonthStartDeferral();
                        } catch {
                            /* deferral removal is best-effort chrome */
                        }
                        return;
                    }
                    localStorage.removeItem(MONTH_START_PROMPT_DEFER_KEY);
                },
                deferMonthStartPrompt(referenceDate = this.core.Date.getTodayISO()) {
                    // P04-D4: deferral writes route through the lifecycle
                    // port in candidate mode, never raw storage.
                    if (p04dIsCandidate()) {
                        try {
                            p04dCandidatePorts.lifecycle.deferMonthStartPrompt(referenceDate);
                        } catch {
                            /* deferral persistence is best-effort chrome */
                        }
                        return;
                    }
                    const monthKey = this.applyTemplatesModal.promptMonthKey || getMonthKey(referenceDate);
                    if (!monthKey || !referenceDate) return;
                    localStorage.setItem(MONTH_START_PROMPT_DEFER_KEY, JSON.stringify({ monthKey, dateStr: referenceDate }));
                },
                shouldShowMonthStartPrompt(referenceDate = this.core.Date.getTodayISO()) {
                    // P04-D4: the month-start apply prompt is a v1 plan flow
                    // (profiles, assignments). Canonical materialization runs
                    // explicitly from Plans, so the auto-prompt stays off and
                    // never reads v1 in candidate mode.
                    if (p04dIsCandidate()) return false;
                    if (this.onboardingState?.status && this.onboardingState.status !== 'completed') return false;
                    const monthKey = getMonthKey(referenceDate);
                    if (!monthKey) return false;
                    if (this.store.getMonthlyTemplateAssignment(referenceDate)) {
                        this.clearMonthStartPromptDeferral();
                        return false;
                    }
                    if (this.templateProfiles.length === 0) return false;
                    const deferral = this.getMonthStartPromptDeferral();
                    if (!deferral) return true;
                    return !(deferral.monthKey === monthKey && deferral.dateStr === referenceDate);
                },
                maybeOpenMonthStartPrompt(referenceDate = this.core.Date.getTodayISO()) {
                    // P04-D4: see shouldShowMonthStartPrompt; the v1 prompt
                    // never opens in candidate mode.
                    if (p04dIsCandidate()) return;
                    if (!this.shouldShowMonthStartPrompt(referenceDate)) return;
                    this.openApplyTemplatesModal({
                        mode: 'monthStart',
                        effectiveDate: referenceDate,
                        profileId: this.store.settings.activeTemplateProfileId,
                        promptMonthKey: getMonthKey(referenceDate)
                    });
                },
                getMonthEndPromptDeferral() {
                    // P04-D4: deferral reads come from the lifecycle port in
                    // candidate mode, never raw storage.
                    if (p04dIsCandidate()) {
                        try {
                            return p04dCandidatePorts.lifecycle.getMonthEndDeferral();
                        } catch {
                            return null;
                        }
                    }
                    try {
                        const parsed = JSON.parse(localStorage.getItem(MONTH_END_PROMPT_DEFER_KEY) || 'null');
                        if (!parsed || typeof parsed !== 'object') return null;
                        const previousMonthKey = typeof parsed.previousMonthKey === 'string' ? parsed.previousMonthKey : '';
                        const dateStr = typeof parsed.dateStr === 'string' ? parsed.dateStr : '';
                        if (!MONTH_KEY_PATTERN.test(previousMonthKey) || !dateStr) return null;
                        return { previousMonthKey, dateStr };
                    } catch (error) {
                        return null;
                    }
                },
                clearMonthEndPromptDeferral() {
                    // P04-D4: deferral removal routes through the lifecycle
                    // port in candidate mode, never raw storage.
                    if (p04dIsCandidate()) {
                        try {
                            p04dCandidatePorts.lifecycle.clearMonthEndDeferral();
                        } catch {
                            /* deferral removal is best-effort chrome */
                        }
                        return;
                    }
                    localStorage.removeItem(MONTH_END_PROMPT_DEFER_KEY);
                },
                deferMonthEndPrompt(previousMonthKey, referenceDate = this.core.Date.getTodayISO()) {
                    // P04-D4: deferral writes route through the lifecycle
                    // port in candidate mode, never raw storage.
                    if (p04dIsCandidate()) {
                        try {
                            p04dCandidatePorts.lifecycle.deferMonthEndPrompt(previousMonthKey, referenceDate);
                        } catch {
                            /* deferral persistence is best-effort chrome */
                        }
                        return;
                    }
                    if (!MONTH_KEY_PATTERN.test(previousMonthKey || '') || !referenceDate) return;
                    localStorage.setItem(MONTH_END_PROMPT_DEFER_KEY, JSON.stringify({ previousMonthKey, dateStr: referenceDate }));
                },
                formatMonthKeyLabel(monthKey) {
                    if (!MONTH_KEY_PATTERN.test(monthKey || '')) return '';
                    const monthDate = this.core.Date.parseLocalDate(`${monthKey}-01`);
                    if (Number.isNaN(monthDate.getTime())) return monthKey;
                    if (this.calendarType === 'hijri') {
                        let label = monthDate.toLocaleDateString(this.t._locale, { calendar: 'islamic', month: 'long', year: 'numeric' });
                        if (this.lang === 'en') label = label.replace(/\s*AH$/i, '');
                        return label;
                    }
                    return monthDate.toLocaleDateString(this.t._locale, { calendar: 'gregory', month: 'long', year: 'numeric' });
                },
                formatVaultTransactionMeta(transaction) {
                    const sourceMonthLabel = transaction?.sourceMonthKey ? this.formatMonthKeyLabel(transaction.sourceMonthKey) : '';
                    const dateLabel = transaction?.date ? this.core.Date.humanize(transaction.date, this.t) : '';
                    return [sourceMonthLabel, dateLabel].filter(Boolean).join(' · ');
                },
                async buildMonthEndDecisionSummary(referenceDate = this.core.Date.getTodayISO()) {
                    const currentMonthKey = getMonthKey(referenceDate);
                    const previousMonthKey = getPreviousMonthKey(referenceDate);
                    if (!currentMonthKey || !previousMonthKey || currentMonthKey === previousMonthKey) return null;
                    const snapshot = await this.store.getMonthFinancialSnapshot(previousMonthKey);
                    if (!snapshot) return null;
                    // P1-03 review fix: settlement math requires the recorded
                    // historical budget. When it is unknown, the calculation is
                    // blocked rather than settled with today's allowance.
                    if (snapshot.budgetKnown === false) return null;
                    return {
                        currentMonthKey,
                        previousMonthKey,
                        previousMonthBudget: snapshot.budget,
                        previousMonthSpent: snapshot.spent,
                        surplus: Math.max(0, snapshot.surplus)
                    };
                },
                openMonthEndDecisionModal(summary) {
                    this.monthEndModal.open = true;
                    this.monthEndModal.isLoading = false;
                    this.monthEndModal.summary = summary;
                },
                handleMonthEndModalVisibilityChange(nextValue) {
                    // P04-D4: closing the modal in candidate mode never arms
                    // a v1 deferral outside the port.
                    if (p04dIsCandidate() && !nextValue) {
                        this.monthEndModal.open = false;
                        return;
                    }
                    if (nextValue) {
                        this.monthEndModal.open = true;
                        return;
                    }
                    this.decideMonthEndPromptLater();
                },
                async maybeHandleMonthEndDecision(referenceDate = this.core.Date.getTodayISO()) {
                    // P04-D4: automatic month-end settlement is a v1 flow
                    // (v1 summaries, v1 settlement records). Canonical cycles
                    // close explicitly through the goals port, so the auto
                    // prompt stays off and never reads v1 in candidate mode.
                    if (p04dIsCandidate()) return false;
                    if (this.onboardingState?.status && this.onboardingState.status !== 'completed') return false;
                    const previousMonthKey = getPreviousMonthKey(referenceDate);
                    if (!MONTH_KEY_PATTERN.test(previousMonthKey || '')) return false;
                    if (this.store.getMonthEndSettlement(previousMonthKey)) {
                        this.clearMonthEndPromptDeferral();
                        return false;
                    }
                    const deferral = this.getMonthEndPromptDeferral();
                    if (deferral && deferral.previousMonthKey === previousMonthKey && deferral.dateStr === referenceDate) {
                        return false;
                    }
                    const summary = await this.buildMonthEndDecisionSummary(referenceDate);
                    if (!summary) {
                        // P1-03 review fix: when settlement is impossible because the
                        // previous month's budget was never recorded, say so instead of
                        // failing silently. The prompt is deferred for today so the
                        // message does not repeat on every reload.
                        if (await this.monthEndBlockedByUnknownBudget(referenceDate)) {
                            this.showToast(this.t.monthEndBudgetUnknown.replace('{month}', this.formatMonthKeyLabel(previousMonthKey)));
                            this.deferMonthEndPrompt(previousMonthKey, referenceDate);
                        }
                        return false;
                    }
                    if (summary.surplus <= 0) {
                        await this.store.settleMonthEndNoSurplus(summary, referenceDate);
                        this.clearMonthEndPromptDeferral();
                        return false;
                    }
                    this.openMonthEndDecisionModal(summary);
                    return true;
                },
                decideMonthEndPromptLater() {
                    // P04-D4: routes through the port-owned deferral.
                    if (p04dIsCandidate()) {
                        const previousMonthKey = this.monthEndModal.summary?.previousMonthKey || getPreviousMonthKey(this.core.Date.getTodayISO());
                        this.deferMonthEndPrompt(previousMonthKey, this.core.Date.getTodayISO());
                        this.monthEndModal.open = false;
                        this.monthEndModal.isLoading = false;
                        this.monthEndModal.summary = null;
                        return;
                    }
                    const previousMonthKey = this.monthEndModal.summary?.previousMonthKey || getPreviousMonthKey(this.core.Date.getTodayISO());
                    this.deferMonthEndPrompt(previousMonthKey, this.core.Date.getTodayISO());
                    this.monthEndModal.open = false;
                    this.monthEndModal.isLoading = false;
                    this.monthEndModal.summary = null;
                },
                // P04-D4: canonical month-end settlement helper. The host
                // close+dispose runs in one write section and is retry-safe
                // (an already-settled month returns its settlement instead
                // of moving money twice); the modal stays loading across
                // the commit so success surfaces only after it is durable.
                async settleMonthEndViaPorts(decision) {
                    if (!this.monthEndHasPositiveSurplus || !this.monthEndModal.summary) return;
                    if (!p04dIsWritable()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                        return;
                    }
                    this.monthEndModal.isLoading = true;
                    try {
                        const ports = p04dCandidatePorts.goals;
                        const settled = decision === 'vault'
                            ? await ports.settleToVault(this.monthEndModal.summary, this.core.Date.getTodayISO())
                            : await ports.settleToBudget(this.monthEndModal.summary, this.core.Date.getTodayISO());
                        if (!settled) {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        await syncP04DCandidateGoals(this);
                        await syncP04DCandidateInsights(this);
                        this.clearMonthEndPromptDeferral();
                        this.monthEndModal.open = false;
                        this.monthEndModal.summary = null;
                        this.showToast(decision === 'vault' ? this.t.monthEndMovedToVault : this.t.monthEndAddedToBudget);
                    } catch {
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                    } finally {
                        this.monthEndModal.isLoading = false;
                    }
                },
                async moveMonthEndSurplusToVault() {
                    // P04-D4: settlement runs through the canonical goals
                    // port (closeCycle + disposeCycleRemainder, append-only)
                    // in candidate mode, never the v1 store.
                    if (p04dIsCandidate()) {
                        await this.settleMonthEndViaPorts('vault');
                        return;
                    }
                    if (!this.monthEndHasPositiveSurplus || !this.monthEndModal.summary) return;
                    this.monthEndModal.isLoading = true;
                    try {
                        await this.store.settleMonthEndToVault(this.monthEndModal.summary, this.core.Date.getTodayISO());
                        await this.store.refreshStatistics(this.store.currentDate);
                        this.clearMonthEndPromptDeferral();
                        this.monthEndModal.open = false;
                        this.monthEndModal.summary = null;
                        this.showToast(this.t.monthEndMovedToVault);
                        this.maybeOpenMonthStartPrompt(this.core.Date.getTodayISO());
                    } finally {
                        this.monthEndModal.isLoading = false;
                    }
                },
                async addMonthEndSurplusToBudget() {
                    // P04-D4: see moveMonthEndSurplusToVault.
                    if (p04dIsCandidate()) {
                        await this.settleMonthEndViaPorts('budget');
                        return;
                    }
                    if (!this.monthEndHasPositiveSurplus || !this.monthEndModal.summary) return;
                    this.monthEndModal.isLoading = true;
                    try {
                        await this.store.settleMonthEndToBudget(this.monthEndModal.summary, this.core.Date.getTodayISO());
                        await this.store.refreshStatistics(this.store.currentDate);
                        this.clearMonthEndPromptDeferral();
                        this.monthEndModal.open = false;
                        this.monthEndModal.summary = null;
                        this.showToast(this.t.monthEndAddedToBudget);
                        this.maybeOpenMonthStartPrompt(this.core.Date.getTodayISO());
                    } finally {
                        this.monthEndModal.isLoading = false;
                    }
                },
                handleApplyTemplatesModalVisibilityChange(nextValue) {
                    // P04-D4: the month-start mode is a v1 flow; closing the
                    // modal in candidate mode never arms a v1 deferral.
                    if (p04dIsCandidate() && !nextValue && this.applyTemplatesModal.mode === 'monthStart') {
                        this.applyTemplatesModal.preview = null;
                        this.applyTemplatesModal.open = false;
                        return;
                    }
                    if (nextValue) {
                        this.applyTemplatesModal.open = true;
                        return;
                    }
                    if (this.applyTemplatesModal.mode === 'monthStart') {
                        this.decideMonthStartPromptLater();
                        return;
                    }
                    this.applyTemplatesModal.open = false;
                },
                openApplyTemplatesModal(options = {}) {
                    const effectiveDate = typeof options?.effectiveDate === 'string' && options.effectiveDate
                        ? options.effectiveDate
                        : (this.store.currentDate || this.core.Date.getTodayISO());
                    const mode = options?.mode === 'monthStart' ? 'monthStart' : 'manual';
                    const resolvedProfileId = this.templateProfiles.some(profile => profile.id === options?.profileId)
                        ? options.profileId
                        : (this.templateProfiles.some(profile => profile.id === this.store.settings.activeTemplateProfileId)
                            ? this.store.settings.activeTemplateProfileId
                            : (this.templateProfiles[0]?.id || ''));
                    this.applyTemplatesModal.open = true;
                    this.applyTemplatesModal.mode = mode;
                    this.applyTemplatesModal.effectiveDate = effectiveDate;
                    this.applyTemplatesModal.preview = null;
                    this.applyTemplatesModal.blockedPlan = null;
                    this.applyTemplatesModal.isLoading = false;
                    this.applyTemplatesModal.selectedProfileId = resolvedProfileId;
                    this.applyTemplatesModal.promptMonthKey = mode === 'monthStart'
                        ? (options?.promptMonthKey || getMonthKey(effectiveDate))
                        : '';
                },
                resetApplyTemplatesPreview() {
                    this.applyTemplatesModal.preview = null;
                    this.applyTemplatesModal.blockedPlan = null;
                },
                selectApplyTemplatesProfile(profileId) {
                    if (!this.templateProfiles.some(profile => profile.id === profileId)) return;
                    this.applyTemplatesModal.selectedProfileId = profileId;
                    this.resetApplyTemplatesPreview();
                },
                decideMonthStartPromptLater() {
                    // P04-D4: routes through the port-owned deferral.
                    if (p04dIsCandidate()) {
                        this.deferMonthStartPrompt(this.core.Date.getTodayISO());
                        this.applyTemplatesModal.preview = null;
                        this.applyTemplatesModal.open = false;
                        return;
                    }
                    this.deferMonthStartPrompt(this.core.Date.getTodayISO());
                    this.applyTemplatesModal.preview = null;
                    this.applyTemplatesModal.open = false;
                },
                async reviewTemplateApplication() {
                    // P04-D4: apply previews derive from committed canonical
                    // plans in candidate mode, never the v1 store.
                    if (p04dIsCandidate()) {
                        await this.reviewTemplateApplicationViaPorts();
                        return;
                    }
                    if (!this.applyTemplatesEffectiveDateValid || !this.selectedApplyTemplatesProfileId) return;
                    this.applyTemplatesModal.isLoading = true;
                    try {
                        const plan = await this.store.buildTemplateApplyPlan(this.applyTemplatesModal.effectiveDate, { profileId: this.selectedApplyTemplatesProfileId });
                        this.applyTemplatesModal.preview = plan.summary;
                        // P1-06 review fix: a legacy monthly template without a day
                        // blocks the whole plan; the preview says so bilingually and
                        // the apply button is withheld.
                        this.applyTemplatesModal.blockedPlan = plan.blocked ? plan : null;
                    } finally {
                        this.applyTemplatesModal.isLoading = false;
                    }
                },
                // P04-D4: canonical plan apply helpers. Materialization is
                // atomic and idempotent with deterministic occurrence IDs: a
                // retry after a lost acknowledgement replays instead of
                // recreating managed occurrences, and paid/detached
                // occurrences are never recreated by the command.
                async confirmTemplateApplicationViaPorts() {
                    if (!this.applyTemplatesEffectiveDateValid) return;
                    if (!p04dIsWritable()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                        return;
                    }
                    this.applyTemplatesModal.isLoading = true;
                    try {
                        const fingerprint = p04dFingerprint({
                            date: this.applyTemplatesModal.effectiveDate,
                            plans: (p04dCandidatePorts.plan.listPlans() || []).map((plan) => plan.planId),
                        });
                        const operationId = p04dIntentOperationId('plan', fingerprint);
                        // One intent, one stable identity per plan: a retry
                        // of the whole apply replays per-plan instead of
                        // duplicating occurrences.
                        const operationIds = {};
                        for (const plan of (p04dCandidatePorts.plan.listPlans() || [])) {
                            operationIds[String(plan.planId)] = `${operationId}:${String(plan.planId)}`.slice(0, 100);
                        }
                        const preview = await p04dCandidatePorts.plan.confirmApply(
                            this.applyTemplatesModal.effectiveDate,
                            this.selectedApplyTemplatesProfileId,
                            { operationIds },
                        );
                        if (preview.blocked) {
                            this.showToast(preview.blockedReason || p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        this.applyTemplatesModal.preview = preview;
                        this.clearMonthStartPromptDeferral();
                        this.applyTemplatesModal.open = false;
                        await syncP04DCandidateHome(this);
                        await syncP04DCandidatePlan(this);
                        await syncP04DCandidateInsights(this);
                        p04dClearIntent('plan');
                        this.showToast(preview.totalChanges > 0 ? this.t.applyTemplatesDone : this.t.noChanges);
                    } catch {
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                    } finally {
                        this.applyTemplatesModal.isLoading = false;
                    }
                },
                async reviewTemplateApplicationViaPorts() {
                    if (!this.applyTemplatesEffectiveDateValid) return;
                    this.applyTemplatesModal.isLoading = true;
                    try {
                        const preview = await p04dCandidatePorts.plan.previewApply(
                            this.applyTemplatesModal.effectiveDate,
                            this.selectedApplyTemplatesProfileId,
                        );
                        this.applyTemplatesModal.preview = preview.blocked ? null : preview;
                        this.applyTemplatesModal.blockedPlan = preview.blocked ? preview : null;
                    } catch {
                        this.applyTemplatesModal.preview = null;
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                    } finally {
                        this.applyTemplatesModal.isLoading = false;
                    }
                },
                async confirmTemplateApplication() {
                    // P04-D4: materialization runs through the canonical plan
                    // port (atomic, idempotent, deterministic occurrence IDs)
                    // in candidate mode, never the v1 store.
                    if (p04dIsCandidate()) {
                        await this.confirmTemplateApplicationViaPorts();
                        return;
                    }
                    if (!this.applyTemplatesEffectiveDateValid || !this.selectedApplyTemplatesProfileId) return;
                    // P1-06 review fix: never reach the write path while the plan is
                    // blocked on a monthly template missing its day.
                    if (this.applyTemplatesModal.blockedPlan) {
                        this.showToast(this.t.planBlockedMonthlyDay.replace('{name}', this.applyTemplatesModal.blockedPlan.blockedTemplates?.[0]?.name || ''));
                        return;
                    }
                    this.applyTemplatesModal.isLoading = true;
                    try {
                        const plan = await this.store.applyTemplatesFrom(this.applyTemplatesModal.effectiveDate, { profileId: this.selectedApplyTemplatesProfileId });
                        // Defense in depth: the store refuses blocked plans before
                        // any write; surface the block instead of reporting success.
                        if (plan.blocked) {
                            this.applyTemplatesModal.blockedPlan = plan;
                            this.showToast(this.t.planBlockedMonthlyDay.replace('{name}', plan.blockedTemplates?.[0]?.name || ''));
                            return;
                        }
                        this.applyTemplatesModal.preview = plan.summary;
                        this.clearMonthStartPromptDeferral();
                        this.applyTemplatesModal.open = false;
                        this.showToast(plan.summary.totalChanges > 0 ? this.t.applyTemplatesDone : this.t.noChanges);
                    } finally {
                        this.applyTemplatesModal.isLoading = false;
                    }
                },

                // --- EXPENSE HANDLING ---
                deleteExpense(id) {
                    // P04-D3: swipe-delete appends a canonical reversal and
                    // hides the reversed entry; the original stays in
                    // canonical history.
                    if (p04dIsCandidate()) {
                        if (!p04dIsWritable()) {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        this.showConfirmDialog(
                            this.t.deleteExpenseQ,
                            this.lang === 'ar'
                                ? 'سيُعكس المصروف مع بقاء السجل الأصلي في السجل.'
                                : 'The expense will be reversed; the original record stays in history.',
                            async () => {
                                const confirmIds = p04dConfirmIds(`del:${id}@${this.store.currentDate}`, [id]);
                                const result = await p04dCandidatePorts.history.deleteExpense(
                                    id,
                                    confirmIds[0] ? { operationId: confirmIds[0] } : undefined,
                                );
                                if (!result.ok) {
                                    this.showToast(result.reason === 'validation' ? this.t.invalidMoneyInput : p04dBlockedCopy(this.lang, 'authority'));
                                    return;
                                }
                                await syncP04DCandidateHome(this);
                                p04dClearIntent('confirm');
                            }
                        );
                        return;
                    }
                    this.showConfirmDialog(
                        this.t.deleteExpenseQ,
                        this.t.cannotUndo,
                        () => {
                            this.store.deleteExpense(id);
                        }
                    );
                },

                // --- SELECTION MODE ---
                enterSelectionMode(expenseId) {
                    this.selectionMode = true;
                    this.selectedExpenseIds = expenseId ? [expenseId] : [];
                },
                exitSelectionMode() {
                    this.selectionMode = false;
                    this.selectedExpenseIds = [];
                },
                toggleExpenseSelection(expenseId) {
                    const idx = this.selectedExpenseIds.indexOf(expenseId);
                    if (idx === -1) {
                        this.selectedExpenseIds.push(expenseId);
                    } else {
                        this.selectedExpenseIds.splice(idx, 1);
                    }
                    if (this.selectedExpenseIds.length === 0) {
                        this.exitSelectionMode();
                    }
                },
                handleExpenseCardClick(expense) {
                    if (this.selectionMode) {
                        this.toggleExpenseSelection(expense.id);
                    } else {
                        this.openEditModal(expense);
                    }
                },
                deleteSelectedExpenses() {
                    const count = this.selectedExpenseIds.length;
                    if (count === 0) return;
                    // P04-D3: batch delete appends one reversal per expense.
                    // A partial failure is explicit and never reports a
                    // false all-success.
                    if (p04dIsCandidate()) {
                        if (!p04dIsWritable()) {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        this.showConfirmDialog(
                            this.t.deleteSelectedQ,
                            this.lang === 'ar'
                                ? 'سيُعكس كل مصروف محدد مع بقاء السجلات الأصلية في السجل.'
                                : 'Each selected expense will be reversed; original records stay in history.',
                            async () => {
                                const ids = [...this.selectedExpenseIds];
                                // Stable per-item identities: a retry of the
                                // same batch reuses the exact ID set, so
                                // already-reversed entries replay instead of
                                // duplicating; IDs never cross payloads.
                                const confirmIds = p04dConfirmIds(
                                    `batch:${[...ids].sort().join(',')}@${this.store.currentDate}`,
                                    ids,
                                );
                                const result = await p04dCandidatePorts.history.deleteSelected(ids, { operationIds: confirmIds });
                                await syncP04DCandidateHome(this);
                                this.exitSelectionMode();
                                if (!result.ok) {
                                    this.showToast(result.reason === 'validation' ? this.t.invalidMoneyInput : p04dBlockedCopy(this.lang, 'partial'));
                                    return;
                                }
                                p04dClearIntent('confirm');
                                this.showToast(this.t.selectionDeleted.replace('{n}', ids.length));
                            }
                        );
                        return;
                    }
                    this.showConfirmDialog(
                        this.t.deleteSelectedQ,
                        this.t.deleteSelectedMsg.replace('{n}', count),
                        async () => {
                            const ids = [...this.selectedExpenseIds];
                            for (const id of ids) {
                                await this.store.deleteExpense(id);
                            }
                            this.exitSelectionMode();
                            this.showToast(this.t.selectionDeleted.replace('{n}', ids.length));
                        }
                    );
                },
                markSelectedUnpaid() {
                    // P04-D3: bulk mark-unpaid has no canonical equivalent
                    // and stays blocked without touching v1 or canonical
                    // state.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'bulkUnpaid'));
                        return;
                    }
                    const paidIds = this.store.currentViewExpenses
                        .filter(e => this.selectedExpenseIds.includes(e.id) && e.isPaid)
                        .map(e => e.id);
                    if (paidIds.length === 0) return;
                    this.showConfirmDialog(
                        this.t.markUnpaidSelectedQ,
                        this.t.markUnpaidSelectedMsg.replace('{n}', paidIds.length),
                        async () => {
                            for (const id of paidIds) {
                                const expense = this.store.currentViewExpenses.find(e => e.id === id);
                                if (expense) {
                                    expense.isPaid = false;
                                    expense.actualPaid = 0;
                                    await this.store.updateExpense(expense);
                                }
                            }
                            await this.store.recalcGlobalStats();
                            await this.store.refreshFlexibleStats(this.store.currentDate);
                            await this.store.refreshStatistics(this.store.currentDate);
                            this.exitSelectionMode();
                            this.showToast(this.t.selectionMarkedUnpaid.replace('{n}', paidIds.length));
                        }
                    );
                },

                // V4: Show custom confirmation dialog
                showConfirmDialog(title, message, onConfirm, confirmText = null, confirmColor = 'danger') {
                    this.confirmDialog.title = title;
                    this.confirmDialog.message = message;
                    this.confirmDialog.onConfirm = onConfirm;
                    this.confirmDialog.confirmText = confirmText;
                    this.confirmDialog.confirmColor = confirmColor;
                    this.confirmDialog.open = true;
                },
                handleConfirmDialogConfirm() {
                    if (this.confirmDialog.onConfirm) {
                        this.confirmDialog.onConfirm();
                    }
                    this.confirmDialog.open = false;
                },
                handleConfirmDialogCancel() {
                    // Explicit cancel ends the pending delete intent: the
                    // next confirmation starts a new one.
                    p04dClearIntent('confirm');
                    this.confirmDialog.open = false;
                },

                resetVaultGoalForm() {
                    this.vaultGoalForm = {
                        name: '',
                        targetAmount: '',
                        allocatedAmount: ''
                    };
                },
                // P04-D4: canonical goal creation helper. One open form keeps
                // one operation identity so a retry after a lost
                // acknowledgement replays instead of duplicating the goal.
                async addVaultGoalViaPorts() {
                    if (!this.vaultGoalFormValid) return;
                    if (!p04dIsWritable()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                        return;
                    }
                    const fingerprint = p04dFingerprint({
                        name: this.vaultGoalForm.name,
                        target: this.vaultGoalForm.targetAmount,
                        allocated: this.vaultGoalForm.allocatedAmount,
                    });
                    const operationId = p04dIntentOperationId('goal', fingerprint);
                    try {
                        const created = await p04dCandidatePorts.goals.addGoal({
                            name: this.vaultGoalForm.name,
                            targetAmount: parseMoneyInput(this.vaultGoalForm.targetAmount),
                            allocatedAmount: this.vaultGoalForm.allocatedAmount === '' || this.vaultGoalForm.allocatedAmount === null
                                ? 0
                                : parseMoneyInput(this.vaultGoalForm.allocatedAmount),
                        }, { operationId });
                        if (!created) {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        await syncP04DCandidateGoals(this);
                        p04dClearIntent('goal');
                        this.resetVaultGoalForm();
                        this.showToast(this.t.goalSaved);
                    } catch {
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                    }
                },
                async addVaultGoal() {
                    // P04-D4: goal creation runs through the canonical goals
                    // port (createGoal plus an explicit opening assignment
                    // when the user provides one) in candidate mode.
                    if (p04dIsCandidate()) {
                        await this.addVaultGoalViaPorts();
                        return;
                    }
                    if (!this.vaultGoalFormValid) return;
                    const goal = await this.store.addVaultGoal({
                        id: this.core.UUID(),
                        name: this.vaultGoalForm.name,
                        targetAmount: parseMoneyInput(this.vaultGoalForm.targetAmount),
                        allocatedAmount: this.vaultGoalForm.allocatedAmount === '' || this.vaultGoalForm.allocatedAmount === null
                            ? 0
                            : parseMoneyInput(this.vaultGoalForm.allocatedAmount)
                    });
                    if (!goal) return;
                    this.resetVaultGoalForm();
                    this.showToast(this.t.goalSaved);
                },
                confirmDeleteVaultGoal(goal) {
                    // P04-D4: goals are append-only with no delete command;
                    // deletion stays visibly blocked, never a v1 write.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'goalDelete'));
                        return;
                    }
                    if (!goal?.id) return;
                    this.showConfirmDialog(
                        this.t.deleteGoalQ,
                        this.t.deleteGoalMsg.replace('{name}', goal.name),
                        async () => {
                            const removed = await this.store.deleteVaultGoal(goal.id);
                            if (removed) this.showToast(this.t.goalDeleted);
                        }
                    );
                },

                // V2: Helper to get variance stripe class
                getVarianceStripeClass(expense) {
                    if (!expense.isPaid) return 'stripe-neutral';
                    if (expense.actualPaid === 0) return 'stripe-success'; // Free = gold stripe reuses success
                    const variance = expense.expectedCost - expense.actualPaid;
                    if (variance > 0) return 'stripe-success';
                    if (variance < 0) return 'stripe-danger';
                    return 'stripe-brand'; // On budget
                },

                // V2: Helper to get variance pill class
                getVariancePillClass(expense) {
                    if (expense.actualPaid === 0) return 'pill-gold';
                    const variance = expense.expectedCost - expense.actualPaid;
                    if (variance > 0) return 'pill-success';
                    if (variance < 0) return 'pill-danger';
                    return 'pill-brand'; // On budget
                },
                formatCompactAmount(value) {
                    const amount = toFiniteNumber(value, 0);
                    return Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2);
                },
                formatVaultGoalPercentage(value) {
                    return `${Math.round(Math.max(0, toFiniteNumber(value, 0)))}%`;
                },
                vaultRingDash(percentage) {
                    const r = 22;
                    const c = 2 * Math.PI * r; // ~138.23
                    const pct = Math.max(0, Math.min(100, toFiniteNumber(percentage, 0)));
                    const fill = (pct / 100) * c;
                    return `${fill.toFixed(1)} ${c.toFixed(1)}`;
                },
                formatSignedCompactAmount(value) {
                    const amount = toFiniteNumber(value, 0);
                    return `${amount > 0 ? '+' : ''}${this.formatCompactAmount(amount)}`;
                },
                getComparisonDeltaClass(value) {
                    const amount = toFiniteNumber(value, 0);
                    if (amount === 0) return 'text-brand-light';
                    return amount < 0 ? 'text-success' : 'text-danger';
                },
                getSpentDeltaLabel() {
                    const delta = toFiniteNumber(this.store.statistics.spentDelta, 0);
                    if (delta === 0) return this.t.sameAsLastMonth;
                    return delta < 0 ? this.t.spentLessThanLastMonth : this.t.spentMoreThanLastMonth;
                },
                getCategoryFlatColor(cat) {
                    const map = {
                        transport: '#3b82f6',
                        food: '#f97316',
                        utilities: '#eab308',
                        tech: '#a855f7',
                        shopping: '#ec4899',
                        other: '#6b7280'
                    };
                    return map[cat] || map.other;
                },
                getDonutSegments() {
                    const stats = this.store.statistics;
                    if (stats.paidSpent <= 0) return [];
                    const segments = [];
                    const radius = 54;
                    const circumference = 2 * Math.PI * radius;
                    let offset = 0;
                    // Essential segment
                    if (stats.essentialSpent > 0) {
                        const pct = stats.essentialSpent / stats.paidSpent;
                        segments.push({
                            color: 'var(--c-accent-success)',
                            dashArray: `${pct * circumference} ${circumference}`,
                            dashOffset: -offset,
                            label: this.t.essential,
                            value: stats.essentialSpent,
                            pct: (pct * 100).toFixed(0)
                        });
                        offset += pct * circumference;
                    }
                    // Luxury segment
                    if (stats.luxurySpent > 0) {
                        const pct = stats.luxurySpent / stats.paidSpent;
                        segments.push({
                            color: '#f59e0b',
                            dashArray: `${pct * circumference} ${circumference}`,
                            dashOffset: -offset,
                            label: this.t.luxury,
                            value: stats.luxurySpent,
                            pct: (pct * 100).toFixed(0)
                        });
                        offset += pct * circumference;
                    }
                    return segments;
                },
                getWeeklyMax() {
                    const weeks = this.store.statistics.weeklySpending || [];
                    return Math.max(1, ...weeks.map(w => w.amount));
                },
                getFlexibleDefinitionStats(definitionId) {
                    return this.flexibleStatsById[definitionId] || null;
                },
                formatFlexibleDefinitionMeta(definition) {
                    const normalized = normalizeDefinitionRecord(definition);
                    return `${this.t.monthlyBudget}: ${this.formatCompactAmount(normalized.monthlyBudget)} SAR · ${this.t.maxUsesPerMonth}: ${normalized.maxUsesPerMonth}`;
                },
                formatFlexibleDefinitionRemaining(definition) {
                    const normalized = normalizeDefinitionRecord(definition);
                    const stats = this.getFlexibleDefinitionStats(normalized.id);
                    const remainingBudget = stats ? stats.remainingBudget : normalized.monthlyBudget;
                    const remainingUses = stats ? stats.remainingUses : normalized.maxUsesPerMonth;
                    return `${this.t.remainingBudget}: ${this.formatCompactAmount(remainingBudget)} SAR · ${this.t.remainingUses}: ${remainingUses}`;
                },
                formatTemplateProfileName(profile) {
                    const normalizedProfile = normalizeTemplateProfileRecord(profile);
                    if (!normalizedProfile) return '';
                    return normalizedProfile.id === LEGACY_TEMPLATE_PROFILE.id ? this.t.legacyProfile : normalizedProfile.name;
                },
                async                 setActiveTemplateProfile(profileId) {
                    // P04-D4: profiles have no canonical counterpart; the
                    // active profile stays a v1-only notion and never writes
                    // in candidate mode.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'profile'));
                        return;
                    }
                    const resolvedProfileId = this.templateProfiles.some(profile => profile.id === profileId)
                        ? profileId
                        : (this.templateProfiles[0]?.id || LEGACY_TEMPLATE_PROFILE.id);
                    this.store.settings.activeTemplateProfileId = resolvedProfileId;
                    await DB.setSetting('activeTemplateProfileId', resolvedProfileId);
                    await this.store.refreshFlexibleStats(this.store.currentDate);
                    this.resetApplyTemplatesPreview();
                },
                async createTemplateProfile() {
                    // P04-D4: profiles have no canonical counterpart; see
                    // setActiveTemplateProfile.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'profile'));
                        return;
                    }
                    const rawName = window.prompt(this.t.profileNamePrompt, '');
                    if (rawName === null) return;

                    const name = rawName.trim();
                    if (!name) {
                        alert(this.t.profileNameRequired);
                        return;
                    }

                    const normalizedName = name.toLocaleLowerCase();
                    const profileExists = this.templateProfiles.some(profile => {
                        const normalizedProfile = normalizeTemplateProfileRecord(profile);
                        const storedName = (normalizedProfile?.name || '').toLocaleLowerCase();
                        const displayName = this.formatTemplateProfileName(profile).toLocaleLowerCase();
                        return storedName === normalizedName || displayName === normalizedName;
                    });

                    if (profileExists) {
                        alert(this.t.profileNameExists);
                        return;
                    }

                    const profile = {
                        id: this.core.UUID(),
                        name,
                        offdays: [...DEFAULT_PROFILE_OFFDAYS]
                    };

                    this.store.settings.templateProfiles = [...this.templateProfiles, profile];
                    await DB.setSetting('templateProfiles', this.store.settings.templateProfiles);
                    await this.setActiveTemplateProfile(profile.id);
                },
                togglePlanSection(section) {
                    this.planSectionsOpen[section] = !this.planSectionsOpen[section];
                },
                async toggleCurrentProfileOffday(dayIndex) {
                    // P04-D4: profile offdays have no canonical counterpart
                    // and never write in candidate mode (see above).
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'profile'));
                        return;
                    }
                    const normalizedDayIndex = normalizeWeekdayIndex(dayIndex);
                    if (normalizedDayIndex === null) return;
                    const currentProfile = this.currentTemplateProfile;
                    if (!currentProfile) return;

                    const nextOffdays = currentProfile.offdays.includes(normalizedDayIndex)
                        ? currentProfile.offdays.filter(value => value !== normalizedDayIndex)
                        : [...currentProfile.offdays, normalizedDayIndex];

                    this.store.settings.templateProfiles = normalizeTemplateProfiles(this.templateProfiles.map(profile => {
                        const normalizedProfile = normalizeTemplateProfileRecord(profile);
                        if (!normalizedProfile || normalizedProfile.id !== currentProfile.id) return profile;
                        return {
                            ...normalizedProfile,
                            offdays: normalizeProfileOffdays(nextOffdays)
                        };
                    }));

                    await DB.setSetting('templateProfiles', this.store.settings.templateProfiles);
                    this.resetApplyTemplatesPreview();
                },
                openFlexibleDefinitionModal() {
                    // P04-D3: flexible definitions are D4-owned and stay
                    // visibly unavailable instead of writing v1.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'flexible'));
                        return;
                    }
                    this.addModal.form = createAddModalForm();
                    this.addModal.mode = 'flexibleDefinition';
                    this.addModal.form.source = 'flexible';
                    this.addModal.open = true;
                },
                selectFlexibleDefinition(definition) {
                    const normalized = normalizeDefinitionRecord(definition);
                    // Guard: prevent picking a fully consumed flexible item
                    const stats = this.getFlexibleDefinitionStats(normalized.id);
                    const remainingBudget = stats ? stats.remainingBudget : normalized.monthlyBudget;
                    const remainingUses = stats ? stats.remainingUses : normalized.maxUsesPerMonth;
                    if (remainingBudget <= 0 || remainingUses <= 0) {
                        this.showToast(this.t.flexExhausted);
                        return;
                    }
                    this.addModal.form.source = 'flexible';
                    this.addModal.form.flexibleDefinitionId = normalized.id;
                    this.addModal.form.name = normalized.name;
                    this.addModal.form.cost = normalized.defaultAmount;
                },
                isFlexibleDefinitionExhausted(definition) {
                    if (!definition) return false;
                    const remainingBudget = toFiniteNumber(definition.remainingBudget, definition.monthlyBudget || 0);
                    const remainingUses = toFiniteNumber(definition.remainingUses, definition.maxUsesPerMonth || 0);
                    return remainingBudget <= 0 || remainingUses <= 0;
                },

                // --- PAYMENT MODAL LOGIC ---
                openPayModal(item) {
                    // P04-D3 correction: in candidate mode the pay modal
                    // never opens — pay and reopen have no canonical
                    // equivalent. A direct invocation (button, swipe, or
                    // test) toasts and returns without opening or mutating.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'pay'));
                        return;
                    }
                    this.payModal.item = item;
                    // Reset Numpad string. If paid, show paid amount. If not, show expected.
                    this.payModal.amount = item.isPaid ? item.actualPaid.toString() : item.expectedCost.toString();
                    this.payModal.autoCleared = false; // V2: Track if first input should clear
                    this.payModal.open = true;
                },

                // V3: EDIT EXPENSE / TEMPLATE MODAL LOGIC
                openEditModal(item, type = 'expense') {
                    // A freshly opened editor is a new intent (see openAddModal).
                    p04dClearIntent('edit');
                    this.editModal.item = item;
                    this.editModal.type = type; // 'expense' or 'template'
                    const normalizedTemplate = type === 'template' ? normalizeDefinitionRecord(item) : null;

                    this.editModal.form = {
                        name: item.name,
                        cost: item.expectedCost,
                        category: item.category,
                        date: item.date || '', // Templates don't have dates
                        recurrence: normalizedTemplate ? normalizedTemplate.recurrence : 'daily',
                        applicability: normalizedTemplate ? normalizedTemplate.applicability : 'everyday',
                        // P1-06 review fix: a legacy monthly template may have no
                        // schedule day; the editor starts empty and requires an
                        // explicit valid day before it can save.
                        monthDay: normalizedTemplate && normalizedTemplate.recurrence === 'monthly'
                            ? (getValidTemplateDays(normalizedTemplate)[0] ?? '')
                            : '',
                        isPaid: !!item.isPaid,
                        actualPaid: item.actualPaid || 0,
                        classification: item.classification || 'essential',
                        profileId: normalizedTemplate ? normalizedTemplate.profileId : LEGACY_TEMPLATE_PROFILE.id
                    };
                    this.editModal.open = true;
                },
                async saveEditedExpense() {
                    if (!this.editModal.item) return;

                    // P04-D3: expense edits append a linked canonical
                    // correction; template edits stay visibly blocked.
                    if (p04dIsCandidate()) {
                        await this.saveEditedExpenseViaPorts();
                        return;
                    }

                    const form = this.editModal.form;
                    const original = this.editModal.item;
                    const expectedCost = parseMoneyInput(form.cost);
                    if (expectedCost === null) {
                        this.showToast(this.t.invalidMoneyInput);
                        return;
                    }

                    if (this.editModal.type === 'template') {
                        const normalizedOriginal = normalizeDefinitionRecord(original);
                        // P1-06 review fix: saving a monthly template requires an
                        // explicit valid day; a legacy dayless template can only be
                        // saved once it is repaired.
                        let monthlyDays = null;
                        if (normalizedOriginal.recurrence === 'monthly') {
                            const occurrenceDay = Math.floor(Number(this.editModal.form.monthDay));
                            if (!Number.isInteger(occurrenceDay) || occurrenceDay < 1 || occurrenceDay > 31) {
                                this.showToast(this.t.monthlyDayRequired);
                                return;
                            }
                            // Keep a legacy multi-day schedule intact when the displayed
                            // first day was left unchanged; an explicit edit replaces it.
                            const originalDays = getValidTemplateDays(normalizedOriginal);
                            monthlyDays = originalDays.length > 0 && originalDays[0] === occurrenceDay
                                ? originalDays
                                : [occurrenceDay];
                        }
                        // Update Template
                        const updatedTemplate = {
                            ...original,
                            name: form.name,
                            expectedCost,
                            category: form.category,
                            recurrence: normalizedOriginal.recurrence,
                            applicability: normalizedOriginal.recurrence === 'daily' ? (form.applicability || normalizedOriginal.applicability || 'everyday') : 'everyday',
                            ...(monthlyDays ? { days: monthlyDays } : {}),
                            profileId: form.profileId || normalizedOriginal.profileId
                        };

                        try {
                            // Update in DB - Fix: Strip reactivity to avoid DataCloneError
                            await DB.saveTemplate(JSON.parse(JSON.stringify(updatedTemplate)));

                            // Update in Store
                            const idx = this.store.templates.findIndex(t => t.id === updatedTemplate.id);
                            if (idx !== -1) {
                                this.store.templates[idx] = updatedTemplate;
                            }
                        } catch (e) {
                            console.error("Template Save Failed", e);
                            alert(this.t.templateSaveFailed + e.message);
                        }

                    } else {
                        // Update Expense
                        const expense = { ...original }; // Clone
                        expense.name = form.name;
                        expense.expectedCost = expectedCost;
                        expense.category = form.category;
                        expense.date = form.date;
                        expense.classification = form.classification || 'essential';

                        if (didExpenseStructureChange(original, expense)) {
                            expense.templateProtected = true;
                        }

                        // Apply unpaid toggle if changed
                        if (form.isPaid === false && original.isPaid === true) {
                            expense.isPaid = false;
                            expense.actualPaid = 0;
                        }

                        // Update Expense - Fix: Strip reactivity to avoid DataCloneError
                        await this.store.updateExpense(JSON.parse(JSON.stringify(expense)));

                        // If date was changed, remove from current view and refresh
                        if (form.date !== original.date) {
                            this.store.currentViewExpenses = this.store.currentViewExpenses.filter(e => e.id !== original.id);
                            await this.store.recalcGlobalStats();
                        }
                    }

                    this.editModal.open = false;
                },
                // P04-D3: append-only canonical correction. The edited
                // amount/date/name/category replace the live fact through
                // `correctExpense` (linked reversal plus replacement); the
                // original record stays in canonical history. Toggling an
                // expense back to unpaid has no canonical equivalent, so it
                // stays blocked instead of silently keeping a paid fact.
                // Classification has no canonical field and keeps the
                // explicit display default; it is never fabricated.
                async saveEditedExpenseViaPorts() {
                    if (!this.editModal.item) return;
                    const ports = p04dCandidatePorts;
                    if (!ports || !p04dIsWritable()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                        return;
                    }
                    if (this.editModal.type === 'template') {
                        this.showToast(p04dBlockedCopy(this.lang, 'template'));
                        return;
                    }
                    const form = this.editModal.form;
                    const original = this.editModal.item;
                    const expectedCost = parseMoneyInput(form.cost);
                    if (expectedCost === null) {
                        this.showToast(this.t.invalidMoneyInput);
                        return;
                    }
                    if (form.isPaid === false) {
                        this.showToast(p04dBlockedCopy(this.lang, 'pay'));
                        return;
                    }
                    // Stable intent identity (see submitNewExpenseViaPorts):
                    // same payload retries reuse the ID, edits mint fresh.
                    const fingerprint = p04dFingerprint({
                        id: original.id,
                        name: form.name,
                        cost: expectedCost,
                        date: form.date || original.date,
                        category: form.category,
                    });
                    const operationId = p04dIntentOperationId('edit', fingerprint);
                    const result = await ports.history.updateExpense({
                        id: original.id,
                        date: form.date || original.date,
                        name: form.name,
                        expectedCost,
                        actualPaid: expectedCost,
                        isPaid: true,
                        category: form.category,
                        classification: '',
                    }, operationId ? { operationId } : undefined);
                    if (!result.ok) {
                        this.showToast(result.reason === 'validation' ? this.t.invalidMoneyInput : p04dBlockedCopy(this.lang, 'authority'));
                        return;
                    }
                    await syncP04DCandidateHome(this);
                    p04dClearIntent('edit');
                    this.editModal.open = false;
                },
                async deleteEditedExpense() {
                    if (!this.editModal.item) return;

                    // P04-D3: expense deletes append a canonical reversal;
                    // template deletes stay visibly blocked.
                    if (p04dIsCandidate()) {
                        if (this.editModal.type === 'template') {
                            this.showToast(p04dBlockedCopy(this.lang, 'template'));
                            return;
                        }
                        if (!p04dIsWritable()) {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        const targetId = this.editModal.item.id;
                        this.showConfirmDialog(
                            this.t.deleteExpenseQ,
                            this.lang === 'ar'
                                ? 'سيُعكس المصروف مع بقاء السجل الأصلي في السجل.'
                                : 'The expense will be reversed; the original record stays in history.',
                            async () => {
                                // Stable intent identity: confirming again
                                // after a false failure reuses the same
                                // reversal ID and replays idempotently.
                                const confirmIds = p04dConfirmIds(`del:${targetId}@${this.store.currentDate}`, [targetId]);
                                const result = await p04dCandidatePorts.history.deleteExpense(
                                    targetId,
                                    confirmIds[0] ? { operationId: confirmIds[0] } : undefined,
                                );
                                if (!result.ok) {
                                    this.showToast(result.reason === 'validation' ? this.t.invalidMoneyInput : p04dBlockedCopy(this.lang, 'authority'));
                                    return;
                                }
                                await syncP04DCandidateHome(this);
                                p04dClearIntent('confirm');
                                this.editModal.open = false;
                            }
                        );
                        return;
                    }

                    if (this.editModal.type === 'template') {
                        this.showConfirmDialog(
                            this.t.deleteTemplateQ,
                            this.t.stopAutoFill,
                            async () => {
                                await DB.deleteTemplate(this.editModal.item.id);
                                this.store.templates = this.store.templates.filter(t => t.id !== this.editModal.item.id);
                                this.editModal.open = false;
                            }
                        );
                    } else {
                        this.showConfirmDialog(
                            this.t.deleteExpenseQ,
                            this.t.cannotUndo,
                            async () => {
                                await this.store.deleteExpense(this.editModal.item.id);
                                this.editModal.open = false;
                            }
                        );
                    }
                },
                markUnpaidFromEdit() {
                    if (!this.editModal.item || this.editModal.type === 'template') return;
                    // P04-D3: reopening has no canonical equivalent, so the
                    // toggle itself stays blocked instead of arming an
                    // unsavable edit.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'pay'));
                        return;
                    }
                    // Just toggle form state — actual save happens on "Update" click
                    this.editModal.form.isPaid = false;
                    this.editModal.form.actualPaid = 0;
                },

                // V2: Smart numpad - auto-clear on first input
                handleNumpadInput(key) {
                    // Auto-clear on first keystroke (if value was pre-filled)
                    if (!this.payModal.autoCleared && this.payModal.amount !== '0') {
                        this.payModal.amount = '';
                        this.payModal.autoCleared = true;
                    }

                    if (key === '.') {
                        if (!this.payModal.amount.includes('.')) {
                            this.payModal.amount = this.payModal.amount === '' ? '0.' : this.payModal.amount + '.';
                        }
                    } else {
                        if (this.payModal.amount === '0') this.payModal.amount = key.toString();
                        else this.payModal.amount += key.toString();
                    }
                },
                handleNumpadDelete() {
                    this.payModal.amount = this.payModal.amount.slice(0, -1);
                    if (this.payModal.amount === '') this.payModal.amount = '0';
                },

                // V2: Quick amount adjusters
                adjustAmount(delta) {
                    let current = parseMoneyInput(this.payModal.amount);
                    if (current === null) {
                        this.showToast(this.t.invalidMoneyInput);
                        return;
                    }
                    current = Math.max(0, current + delta); // Don't go below 0
                    this.payModal.amount = current.toString();
                    this.payModal.autoCleared = true; // Mark as modified
                },

                // V2: Mark as Free (100% savings)
                async markAsFree() {
                    // P04-D3: paid-amount semantics stay blocked in
                    // candidate mode (see commitPayment).
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'pay'));
                        return;
                    }
                    this.payModal.amount = '0';
                    await this.commitPayment();
                },

                // V2: Get color class based on payment vs expected
                getPaymentAmountClass() {
                    if (!this.payModal.item) return '';
                    const amount = parseMoneyInput(this.payModal.amount) ?? -1;
                    const expected = this.payModal.item.expectedCost;
                    if (amount === 0) return 'text-lime-400'; // Free
                    if (amount < expected) return 'text-success'; // Saved
                    if (amount > expected) return 'text-danger'; // Overspent
                    return 'text-brand-light'; // On budget
                },

                async commitPayment() {
                    // P04-D3: a paid actual cannot be mutated in place and
                    // there is no dated unpaid obligation to create, so pay
                    // stays visibly blocked and never falls through to v1.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'pay'));
                        return;
                    }
                    const amt = parseMoneyInput(this.payModal.amount);
                    if (amt === null) {
                        this.showToast(this.t.invalidMoneyInput);
                        return;
                    }

                    const item = this.payModal.item;

                    // Update Item
                    item.isPaid = true;
                    item.actualPaid = amt;

                    await this.store.updateExpense(JSON.parse(JSON.stringify(item)));

                    // P1 review fix: paying less than expected is not celebrated.
                    // Rushd must not reward underspending, so the old "savings joy"
                    // confetti on positive variance is removed entirely.

                    this.payModal.open = false;
                },
                async markUnpaid() {
                    // P04-D3: reopening a paid actual has no exact canonical
                    // equivalent; correct or reverse it from history instead.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'pay'));
                        return;
                    }
                    const item = this.payModal.item;
                    item.isPaid = false;
                    item.actualPaid = 0;
                    await this.store.updateExpense(JSON.parse(JSON.stringify(item)));
                    this.payModal.open = false;
                },

                // --- ADD MODAL LOGIC ---
                openAddModal() {
                    const fab = this.$refs.fabBtn;
                    if (fab) {
                        fab.classList.remove('fab-burst');
                        void fab.offsetWidth;
                        fab.classList.add('fab-burst');
                    }
                    // A freshly opened modal is a new intent: retries of a
                    // previous intent are over (success, cancel, or close),
                    // so the next submit mints its own operation identity.
                    p04dClearIntent('add');
                    this.addModal.form = createAddModalForm();
                    this.addModal.mode = 'expense';
                    this.addModal.open = true;
                },
                async submitNewExpense() {
                    // V2: Prevent double-entry with isSubmitting flag
                    if (this.addModal.isSubmitting) return;
                    // P04-D3: manual Add commits through the canonical
                    // capture port; template/flexible creation stays
                    // visibly unavailable instead of writing v1.
                    if (p04dIsCandidate()) {
                        await this.submitNewExpenseViaPorts();
                        return;
                    }
                    if (!this.addModal.form.name) return;

                    this.addModal.isSubmitting = true;
                    try {
                        const cost = parseMoneyInput(this.addModal.form.cost);
                        if (cost === null) {
                            this.showToast(this.t.invalidMoneyInput);
                            return;
                        }
                        const monthlyBudget = this.addModal.mode === 'flexibleDefinition'
                            ? parseMoneyInput(this.addModal.form.monthlyBudget)
                            : null;
                        if (this.addModal.mode === 'flexibleDefinition' && monthlyBudget === null) {
                            this.showToast(this.t.invalidMoneyInput);
                            return;
                        }
                        const activeTemplateProfileId = getDefinitionProfileId({ profileId: this.store.settings.activeTemplateProfileId });
                        if (this.addModal.mode === 'template') {
                            // P1-06: a monthly template must carry an explicit valid
                            // occurrence day so it can never save silently and then
                            // produce zero occurrences.
                            let monthlyDays = null;
                            if ((this.addModal.form.recurrence || 'daily') === 'monthly') {
                                const occurrenceDay = Math.floor(Number(this.addModal.form.monthDay));
                                if (!Number.isInteger(occurrenceDay) || occurrenceDay < 1 || occurrenceDay > 31) {
                                    this.showToast(this.t.monthlyDayRequired);
                                    return;
                                }
                                monthlyDays = [occurrenceDay];
                            }
                            // Save as template
                            const template = {
                                id: this.core.UUID(),
                                name: this.addModal.form.name,
                                expectedCost: cost,
                                category: this.addModal.form.category,
                                source: 'template',
                                recurrence: this.addModal.form.recurrence || 'daily',
                                applicability: this.addModal.form.recurrence === 'daily' ? (this.addModal.form.applicability || 'everyday') : 'everyday',
                                ...(monthlyDays ? { days: monthlyDays } : {}),
                                profileId: activeTemplateProfileId
                            };
                            await DB.saveTemplate(JSON.parse(JSON.stringify(template)));
                            this.store.templates.push(normalizeDefinitionRecord(template));
                        } else if (this.addModal.mode === 'flexibleDefinition') {
                            const flexibleDefinition = {
                                id: this.core.UUID(),
                                source: 'flexible',
                                name: this.addModal.form.name,
                                expectedCost: cost,
                                defaultAmount: cost,
                                monthlyBudget,
                                maxUsesPerMonth: Math.max(0, parseInt(this.addModal.form.maxUsesPerMonth, 10) || 0),
                                profileId: activeTemplateProfileId
                            };
                            await DB.saveTemplate(JSON.parse(JSON.stringify(flexibleDefinition)));
                            this.store.templates.push(normalizeDefinitionRecord(flexibleDefinition));
                            await this.store.refreshFlexibleStats(this.store.currentDate);
                        } else {
                            // Save as expense
                            if (this.addModal.form.source === 'flexible' && !this.addModal.form.flexibleDefinitionId) {
                                alert(this.t.flexibleItemRequired);
                                return;
                            }

                            const isFlexibleExpense = this.addModal.form.source === 'flexible' && !!this.addModal.form.flexibleDefinitionId;
                            await this.store.addExpense({
                                name: this.addModal.form.name,
                                expectedCost: cost,
                                category: this.addModal.form.category,
                                classification: this.addModal.form.classification || 'essential',
                                source: isFlexibleExpense ? 'flexible' : 'manual',
                                flexibleDefinitionId: isFlexibleExpense ? this.addModal.form.flexibleDefinitionId : null,
                                actualPaid: 0,
                                isPaid: false,
                                date: this.store.currentDate
                            });
                        }
                        this.addModal.open = false;
                    } finally {
                        this.addModal.isSubmitting = false;
                    }
                },
                // P04-D3: manual Add through the canonical capture port and
                // the P03 gateway. The user-entered amount is an actual
                // committed outflow. The modal closes and totals refresh
                // only after the durable commit; any validation, authority,
                // revision, operation-ID, storage, or acknowledgement
                // failure leaves the modal open and retryable with no
                // duplicate record (one operation identity per intent).
                async submitNewExpenseViaPorts() {
                    if (this.addModal.isSubmitting) return;
                    const ports = p04dCandidatePorts;
                    if (!ports || !p04dIsWritable()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                        return;
                    }
                    if (this.addModal.mode === 'template') {
                        this.showToast(p04dBlockedCopy(this.lang, 'template'));
                        return;
                    }
                    if (this.addModal.mode === 'flexibleDefinition') {
                        this.showToast(p04dBlockedCopy(this.lang, 'flexible'));
                        return;
                    }
                    if (!this.addModal.form.name) return;
                    if (this.addModal.form.source === 'flexible') {
                        this.showToast(p04dBlockedCopy(this.lang, 'flexible'));
                        return;
                    }
                    const cost = parseMoneyInput(this.addModal.form.cost);
                    if (cost === null) {
                        this.showToast(this.t.invalidMoneyInput);
                        return;
                    }
                    this.addModal.isSubmitting = true;
                    try {
                        // Stable intent identity: the same ID is reused while
                        // this modal's payload is unchanged, so a retry after
                        // a false/ambiguous failure (including commit-then-
                        // `ok:false`) replays idempotently. A changed payload
                        // mints fresh instead of reusing an ID.
                        const fingerprint = p04dFingerprint({
                            name: this.addModal.form.name,
                            cost,
                            category: this.addModal.form.category,
                            date: this.store.currentDate,
                        });
                        const operationId = p04dIntentOperationId('add', fingerprint);
                        const result = await ports.capture.submitExpense({
                            name: this.addModal.form.name,
                            cost,
                            category: this.addModal.form.category,
                            classification: '',
                            source: 'manual',
                            flexibleDefinitionId: null,
                            date: this.store.currentDate,
                            ...(operationId ? { operationId } : {}),
                        });
                        if (!result.ok) {
                            this.showToast(result.reason === 'validation' ? this.t.invalidMoneyInput : p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        // Resync committed state before the intent closes, so
                        // the next intent starts from committed truth.
                        await syncP04DCandidateHome(this);
                        p04dClearIntent('add');
                        this.addModal.open = false;
                        this.addModal.form = createAddModalForm();
                    } finally {
                        this.addModal.isSubmitting = false;
                    }
                },

                // --- SETTINGS LOGIC ---
                applyTheme(theme, persist = true) {
                    const resolvedTheme = theme === 'light' ? 'light' : 'dark';
                    this.store.settings.theme = resolvedTheme;
                    document.documentElement.dataset.theme = resolvedTheme;
                    document.documentElement.style.colorScheme = resolvedTheme;
                    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_META_COLORS[resolvedTheme]);
                    // P04-D4: in candidate mode persistence belongs to the
                    // lifecycle port; applying chrome never writes storage.
                    if (persist && !p04dIsCandidate()) localStorage.setItem('rushd_theme', resolvedTheme);
                },
                async setTheme(theme) {
                    const resolvedTheme = theme === 'light' ? 'light' : 'dark';
                    // P04-D4: theme preference writes route through the
                    // lifecycle port in candidate mode, never v1 storage.
                    if (p04dIsCandidate()) {
                        try {
                            await p04dCandidatePorts.lifecycle.setTheme(resolvedTheme);
                        } catch {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        this.applyTheme(resolvedTheme, false);
                        return;
                    }
                    this.applyTheme(resolvedTheme);
                    await DB.setSetting('theme', resolvedTheme);
                },
                resolveAutoMotionLevel() {
                    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
                    const deviceMemory = Number(navigator.deviceMemory || 0);
                    const hardwareConcurrency = Number(navigator.hardwareConcurrency || 0);
                    const saveData = !!connection?.saveData;
                    const smallTouchViewport = window.matchMedia && window.matchMedia('(max-width: 820px)').matches && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
                    if (saveData || (deviceMemory && deviceMemory <= 3) || (hardwareConcurrency && hardwareConcurrency <= 4)) return 'lite';
                    if (smallTouchViewport || (deviceMemory && deviceMemory <= 6) || (hardwareConcurrency && hardwareConcurrency <= 6)) return 'balanced';
                    return 'full';
                },
                resolveEffectiveMotionLevel(level = this.store.settings.motionLevel) {
                    const resolvedLevel = normalizeMotionLevel(level);
                    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    if (prefersReducedMotion) return 'reduce';
                    return resolvedLevel === 'auto' ? this.resolveAutoMotionLevel() : resolvedLevel;
                },
                applyMotionProfile(level, persist = true) {
                    const resolvedLevel = normalizeMotionLevel(level);
                    const effectiveLevel = this.resolveEffectiveMotionLevel(resolvedLevel);
                    this.store.settings.motionLevel = resolvedLevel;
                    document.documentElement.dataset.motionSetting = resolvedLevel;
                    document.documentElement.dataset.motion = effectiveLevel;
                    // P04-D4: in candidate mode persistence belongs to the
                    // lifecycle port; applying chrome never writes storage.
                    if (persist && !p04dIsCandidate()) localStorage.setItem('rushd_motion', resolvedLevel);
                },
                async setMotionLevel(level) {
                    const resolvedLevel = normalizeMotionLevel(level);
                    // P04-D4: motion preference writes route through the
                    // lifecycle port in candidate mode, never v1 storage.
                    if (p04dIsCandidate()) {
                        try {
                            await p04dCandidatePorts.lifecycle.setMotionLevel(resolvedLevel);
                        } catch {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        this.applyMotionProfile(resolvedLevel, false);
                        return;
                    }
                    this.applyMotionProfile(resolvedLevel);
                    await DB.setSetting('motionLevel', resolvedLevel);
                },
                async saveSettings() {
                    // P04-D4: the monthly allowance migrated into the opening
                    // cycle starting funds and no canonical command rewrites
                    // it. The figure stays read-only: revert the typed value
                    // to the canonical mirror so the display never suggests
                    // an unsaved edit, and never touch v1.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'allowance'));
                        await syncP04DCandidateSettings(this);
                        return;
                    }
                    const baseAllowance = parseMoneyInput(this.store.settings.baseAllowance);
                    if (baseAllowance === null) {
                        this.showToast(this.t.invalidMoneyInput);
                        return;
                    }
                    this.store.settings.baseAllowance = baseAllowance;
                    await DB.setSetting('baseAllowance', baseAllowance);
                    // P1-03: the explicit change is recorded for the live month only;
                    // older months keep the allowance recorded while they were active.
                    await this.store.recordCurrentMonthBaseAllowance();
                    await this.store.recalcGlobalStats();
                    await this.store.refreshStatistics(this.store.currentDate);
                },
                // P1-05: setSafeToSpendMode was removed with the fake weekly view.
                async deleteTemplate(id) {
                    // P04-D4: recurring plans are append-only with no delete
                    // command; deletion stays visibly blocked, never a v1
                    // write.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'templateDelete'));
                        return;
                    }
                    this.showConfirmDialog(
                        this.t.deleteTemplateQ,
                        this.t.stopAutoFill,
                        async () => {
                            await DB.deleteTemplate(id);
                            this.store.templates = this.store.templates.filter(t => t.id !== id);
                        }
                    );
                },
                openTemplateModal() {
                    // P04-D3: template creation is D4-owned and stays
                    // visibly unavailable instead of writing v1.
                    if (p04dIsCandidate()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'template'));
                        return;
                    }
                    // Open the add modal in template mode
                    this.addModal.form = createAddModalForm();
                    this.addModal.mode = 'template';
                    this.addModal.open = true;
                },
                async buildBackupSnapshot() {
                    // P04-D4: versioned export comes from the canonical
                    // portability port in candidate mode, never v1 reads.
                    if (p04dIsCandidate()) {
                        return p04dCandidatePorts.portability.buildSnapshot();
                    }
                    const data = {
                        version: '3.1',
                        exportedAt: new Date().toISOString(),
                        settings: this.store.settings,
                        templates: this.store.templates,
                        expenses: await DB.getAllExpenses()
                    };
                    return JSON.stringify(data, null, 2);
                },
                downloadBackupFile(jsonStr) {
                    const blob = new Blob([jsonStr], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `rushd-backup-${Core.Date.getTodayISO()}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                },
                async exportData() {
                    try {
                        this.downloadBackupFile(await this.buildBackupSnapshot());
                    } catch (err) {
                        console.error('Export failed:', err);
                        alert(this.t.exportFailed);
                    }
                },
                // P04-D4: canonical import helper. The file is parsed and
                // confirmed exactly like the legacy flow, but the restore
                // goes through the P04-C commit point: success surfaces only
                // after durable activation, and the shell resyncs from the
                // new active storage before anything renders.
                importDataViaPorts(event) {
                    const file = event.target.files[0];
                    if (!file) return;
                    if (!p04dIsWritable()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        let data;
                        try {
                            data = JSON.parse(e.target.result);
                        } catch (err) {
                            console.error('Import Error:', err);
                            alert(this.t.invalidBackup);
                            return;
                        }
                        this.showConfirmDialog(
                            this.t.importQ,
                            this.t.importMsg,
                            async () => {
                                try {
                                    const fingerprint = p04dFingerprint(data);
                                    const importId = p04dIntentOperationId('import', fingerprint);
                                    const result = await p04dCandidatePorts.portability.restoreSnapshot(data, {
                                        importId,
                                        confirmation: 'REPLACE-ACTIVE-DATABASE',
                                    });
                                    if (!result.ok) {
                                        alert(this.t.invalidBackup);
                                        return;
                                    }
                                    await syncP04DCandidateHome(this);
                                    await syncP04DCandidatePlan(this);
                                    await syncP04DCandidateInsights(this);
                                    await syncP04DCandidateGoals(this);
                                    p04dClearIntent('import');
                                    this.currentView = 'dashboard';
                                    this.showToast(this.t.importSuccess);
                                } catch (err) {
                                    console.error('Canonical import failed:', err);
                                    alert(this.t.invalidBackup);
                                }
                            }
                        );
                    };
                    reader.readAsText(file);
                },
                importData(event) {
                    // P04-D4: versioned import runs through the canonical
                    // portability port (preview/confirm commit point) in
                    // candidate mode, never v1 restore paths.
                    if (p04dIsCandidate()) {
                        this.importDataViaPorts(event);
                        return;
                    }
                    const file = event.target.files[0];
                    if (!file) return;

                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        let data;
                        try {
                            data = JSON.parse(e.target.result);
                        } catch (err) {
                            console.error('Import Error:', err);
                            alert(this.t.invalidBackup);
                            return;
                        }

                        // P1-10: strict structural validation rejects malformed
                        // backups before any canonical store is touched.
                        const validation = validateBackupPayload(data);
                        if (!validation.ok) {
                            console.error('Import rejected, invalid backup structure:', validation.reason);
                            alert(this.t.invalidBackup);
                            return;
                        }

                        this.showConfirmDialog(
                            this.t.importQ,
                            this.t.importMsg,
                            async () => {
                                try {
                                    // P0-03: settings, templates, and expenses are
                                    // written in one atomic IndexedDB transaction,
                                    // so a failure cannot leave a partial import.
                                    const settingsEntries = [];
                                    if (data.settings) {
                                        const importedSettings = data.settings;
                                        if (importedSettings.baseAllowance !== undefined) {
                                            settingsEntries.push({ key: 'baseAllowance', value: normalizePersistedMoney(importedSettings.baseAllowance) });
                                        }
                                        if (importedSettings.safeToSpendMode !== undefined) {
                                            // P1-05: the weekly view was removed; imports
                                            // normalize to the honest monthly view.
                                            settingsEntries.push({ key: 'safeToSpendMode', value: 'monthly' });
                                        }
                                        settingsEntries.push({ key: 'motionLevel', value: normalizeMotionLevel(importedSettings.motionLevel) });
                                        if (importedSettings.theme) {
                                            settingsEntries.push({ key: 'theme', value: importedSettings.theme });
                                        }
                                        if (Array.isArray(importedSettings.templateProfiles)) {
                                            settingsEntries.push({ key: 'templateProfiles', value: importedSettings.templateProfiles });
                                        }
                                        if (importedSettings.activeTemplateProfileId) {
                                            settingsEntries.push({ key: 'activeTemplateProfileId', value: importedSettings.activeTemplateProfileId });
                                        }
                                        if (Array.isArray(importedSettings.monthlyTemplateAssignments)) {
                                            settingsEntries.push({ key: 'monthlyTemplateAssignments', value: importedSettings.monthlyTemplateAssignments });
                                        }
                                        if (importedSettings.vault) {
                                            settingsEntries.push({ key: 'vault', value: importedSettings.vault });
                                        }
                                        if (Array.isArray(importedSettings.monthEndSettlements)) {
                                            settingsEntries.push({ key: 'monthEndSettlements', value: importedSettings.monthEndSettlements });
                                        }
                                        if (isPlainObjectRecord(importedSettings.monthlyBaseAllowances)) {
                                            settingsEntries.push({ key: 'monthlyBaseAllowances', value: normalizeMonthlyBaseAllowances(importedSettings.monthlyBaseAllowances) });
                                        }
                                    }

                                    await DB.restoreBackupRecords({
                                        settingsEntries,
                                        templates: Array.isArray(data.templates) ? data.templates : [],
                                        expenses: data.expenses
                                    });

                                    localStorage.setItem('rushd_import_success', '1');
                                    await this.store.init();
                                    this.applyTheme(this.store.settings.theme);
                                    this.applyMotionProfile(this.store.settings.motionLevel);
                                    this.dateWindow = this.core.Date.generateWindow(this.core.Date.getTodayISO(), 60, 60, this.t._locale);
                                    this.$nextTick(() => this.centerDateScroller(this.store.currentDate));
                                    this.currentView = 'dashboard';
                                    this.showToast(this.t.importSuccess);
                                    localStorage.removeItem('rushd_import_success');
                                } catch (err) {
                                    console.error('Import save failed:', err);
                                    alert(this.t.importFailed + (err && err.message ? err.message : ''));
                                }
                            },
                            this.t.importBtn,
                            'brand'
                        );
                    };
                    reader.readAsText(file);
                    event.target.value = '';
                },
                // P04-D4: canonical export-first reset helper. The safety
                // backup downloads before anything destructive runs; the
                // reset commits through the P04-C commit point and the shell
                // resyncs from the new active storage before success shows.
                async resetAppViaPorts() {
                    if (!p04dIsWritable()) {
                        this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                        return;
                    }
                    this.showConfirmDialog(
                        this.t.factoryResetQ,
                        this.t.factoryResetMsg,
                        async () => {
                            try {
                                this.downloadBackupFile(await p04dCandidatePorts.portability.buildSnapshot());
                            } catch (err) {
                                console.error('Reset safety export failed:', err);
                                this.showConfirmDialog(this.t.resetFailedTitle, this.t.resetBackupFailed, () => {}, this.t.dialogOk, 'brand');
                                return;
                            }
                            try {
                                const fingerprint = p04dFingerprint({ at: this.store.currentDate });
                                const resetId = p04dIntentOperationId('reset', fingerprint);
                                await p04dCandidatePorts.portability.factoryReset({
                                    resetId,
                                    confirmation: 'RESET-GUEST-SCOPE',
                                    onBlocked: () => {
                                        this.showConfirmDialog(
                                            this.t.resetWaitingTitle,
                                            this.t.resetWaiting,
                                            () => {},
                                            this.t.dialogOk,
                                            'brand'
                                        );
                                    },
                                });
                            } catch (e) {
                                console.error('Canonical reset failed:', e);
                                this.showConfirmDialog(this.t.resetFailedTitle, this.t.resetBackupFailed, () => {}, this.t.dialogOk, 'brand');
                                return;
                            }
                            await syncP04DCandidateHome(this);
                            await syncP04DCandidatePlan(this);
                            await syncP04DCandidateInsights(this);
                            await syncP04DCandidateGoals(this);
                            p04dClearIntent('reset');
                            this.clearRushdLocalState();
                            location.reload();
                        }
                    );
                },
                async resetApp() {
                    // P04-D4: export-first reset runs through the canonical
                    // portability port in candidate mode, never v1 reset.
                    if (p04dIsCandidate()) {
                        await this.resetAppViaPorts();
                        return;
                    }
                    this.showConfirmDialog(
                        this.t.factoryResetQ,
                        this.t.factoryResetMsg,
                        async () => {
                            // P0-08: export-first reset. If the safety backup cannot
                            // be created, the reset is cancelled and data stays intact.
                            try {
                                this.downloadBackupFile(await this.buildBackupSnapshot());
                            } catch (err) {
                                console.error('Reset safety export failed:', err);
                                this.showConfirmDialog(this.t.resetFailedTitle, this.t.resetBackupFailed, () => {}, this.t.dialogOk, 'brand');
                                return;
                            }

                            try {
                                await DB.factoryReset(() => {
                                    this.showConfirmDialog(
                                        this.t.resetWaitingTitle,
                                        this.t.resetWaiting,
                                        () => {},
                                        this.t.dialogOk,
                                        'brand'
                                    );
                                });
                            } catch (e) {
                                console.error('Factory reset failed:', e);
                                this.showConfirmDialog(this.t.resetFailedTitle, this.t.resetFailed, () => {}, this.t.dialogOk, 'brand');
                                return;
                            }

                            this.clearRushdLocalState();
                            location.reload();
                        }
                    );
                },
                clearRushdLocalState() {
                    // P04-D4: local-preference clearing routes through the
                    // portability port in candidate mode, never raw storage.
                    if (p04dIsCandidate()) {
                        try {
                            p04dCandidatePorts.portability.clearLocalPreferences();
                        } catch {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                        }
                        return;
                    }
                    // P0-08: remove every Rushd-owned preference so the reset is
                    // complete; language, calendar, and prompt deferrals are included.
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i += 1) {
                        const key = localStorage.key(i);
                        if (key && (key.startsWith('rushd_') || key.startsWith('microsave_') || key === ONBOARDING_STATE_KEY)) {
                            keysToRemove.push(key);
                        }
                    }
                    for (const key of keysToRemove) {
                        localStorage.removeItem(key);
                    }
                },

                // --- LANGUAGE ---
                setLang(newLang) {
                    // P04-D4: language preference writes route through the
                    // lifecycle port in candidate mode, never raw storage.
                    if (p04dIsCandidate()) {
                        try {
                            p04dCandidatePorts.lifecycle.setLanguage(newLang);
                        } catch {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        this.lang = newLang;
                        this.applyLangDirection();
                        return;
                    }
                    this.lang = newLang;
                    localStorage.setItem('rushd_lang', newLang);
                    this.applyLangDirection();
                },
                setCalendarType(type) {
                    // P04-D4: calendar preference writes route through the
                    // lifecycle port in candidate mode, never raw storage.
                    if (p04dIsCandidate()) {
                        try {
                            p04dCandidatePorts.lifecycle.setCalendarType(type);
                        } catch {
                            this.showToast(p04dBlockedCopy(this.lang, 'authority'));
                            return;
                        }
                        this.calendarType = type;
                        return;
                    }
                    this.calendarType = type;
                    localStorage.setItem('rushd_calendar', type);
                },
                applyLangDirection() {
                    const dir = this.lang === 'ar' ? 'rtl' : 'ltr';
                    document.documentElement.dir = dir;
                    document.documentElement.lang = this.lang;
                },

                // --- HELPERS ---
                getCategoryIcon(cat) {
                    const map = {
                        transport: 'directions_car',
                        food: 'restaurant',
                        utilities: 'bolt',
                        tech: 'devices',
                        shopping: 'shopping_bag',
                        other: 'category'
                    };
                    return map[cat] || 'category';
                },
                getCategoryColor(cat) {
                    const colors = {
                        transport: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                        food: 'linear-gradient(135deg, #f97316, #ea580c)',
                        utilities: 'linear-gradient(135deg, #eab308, #ca8a04)',
                        tech: 'linear-gradient(135deg, #a855f7, #9333ea)',
                        shopping: 'linear-gradient(135deg, #ec4899, #be185d)',
                        other: 'linear-gradient(135deg, #6b7280, #4b5563)'
                    };
                    return colors[cat] || colors.other;
                },
                getExpenseSource(expense) {
                    return EXPENSE_SOURCE_VALUES.includes(expense?.source) ? expense.source : 'manual';
                },
                getExpenseSourceIndicatorClass(expense) {
                    return `source-${this.getExpenseSource(expense)}`;
                },
                // P1-06 review fix: true when a monthly template carries at least one
                // valid occurrence day; false exposes legacy dayless templates.
                monthlyTemplateScheduleValid(tmpl) {
                    return !!tmpl && Array.isArray(tmpl.days) && tmpl.days.some(day => Number.isInteger(day) && day >= 1 && day <= 31);
                },
                // P1-03 review fix: the Home hero's unknown-budget state routes to the
                // full explanation in Statistics instead of a bare "Not recorded".
                showHistoricalBudgetExplanation() {
                    this.navigateTo('statistics');
                },
                // P1-03 review fix: month-end settlement that cannot run because the
                // previous month's budget is unknown reports itself truthfully.
                async monthEndBlockedByUnknownBudget(referenceDate) {
                    const previousMonthKey = getPreviousMonthKey(referenceDate);
                    if (!MONTH_KEY_PATTERN.test(previousMonthKey || '')) return false;
                    const snapshot = await this.store.getMonthFinancialSnapshot(previousMonthKey);
                    return !!snapshot && snapshot.budgetKnown === false;
                },
                showToast(message) {
                    this.toastMessage = message;
                    this.toastVisible = true;
                    clearTimeout(this._toastTimer);
                    this._toastTimer = setTimeout(() => { this.toastVisible = false; }, 2200);
                }
            },
            mounted() {
                if (this.isRoot) {
                    this.initApp();
                }
            }
        });

        /**
         * ================================================================
         * MODULE: PROFILE PANEL
         * ================================================================
         * P1-11/P1-12: the hard-coded analytics trend and the XP/badge engine
         * that rewarded underspending and wealth were removed. Momentum is
         * rebuilt properly in P11 and will never count spending amount, wealth,
         * transaction counts, or app opens.
         */

        app.mixin({
            data() {
                return {
                    showProfile: false
                };
            }
        });

        // ================================================================
        // FINAL INJECTION: PROFILE MODAL TEMPLATE
        // ================================================================
        // We inject this HTML dynamically because the root template is already defined.
        // In a normal build step, this would be in the template file.
        // Since we are doing a single-file hack, we append a component.


        registerProfileOverlay(app, dataRuntime);


        // ================================================================
        // FINAL SYSTEM LAUNCH
        // ================================================================

        // 1. Mount the App



}
