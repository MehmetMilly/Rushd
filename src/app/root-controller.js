// P02 compatibility controller. P05/P06 own component and route redesign.
import { Core } from '../shared/core.js';
import { TRANSLATIONS } from './i18n/translations.js';
import { registerProfileOverlay } from '../components/register-profile-overlay.js';

export function installRootController(app, dataRuntime, environment = globalThis) {
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
                    return this.store.safeToSpend;
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
                },
                async persistOnboardingState(status, source = '') {
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
                async resolveOnboardingTargetProfileId() {
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
                async persistOnboardingTemplateItems(profileId) {
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
                    this.openOnboardingModal({
                        source: 'settings',
                        effectiveDate: this.core.Date.getTodayISO(),
                        profileId: this.store.settings.activeTemplateProfileId
                    });
                },
                async initApp() {
                    if (!this.isRoot) return;

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
                selectDate(iso) {
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
                    localStorage.removeItem(MONTH_START_PROMPT_DEFER_KEY);
                },
                deferMonthStartPrompt(referenceDate = this.core.Date.getTodayISO()) {
                    const monthKey = this.applyTemplatesModal.promptMonthKey || getMonthKey(referenceDate);
                    if (!monthKey || !referenceDate) return;
                    localStorage.setItem(MONTH_START_PROMPT_DEFER_KEY, JSON.stringify({ monthKey, dateStr: referenceDate }));
                },
                shouldShowMonthStartPrompt(referenceDate = this.core.Date.getTodayISO()) {
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
                    if (!this.shouldShowMonthStartPrompt(referenceDate)) return;
                    this.openApplyTemplatesModal({
                        mode: 'monthStart',
                        effectiveDate: referenceDate,
                        profileId: this.store.settings.activeTemplateProfileId,
                        promptMonthKey: getMonthKey(referenceDate)
                    });
                },
                getMonthEndPromptDeferral() {
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
                    localStorage.removeItem(MONTH_END_PROMPT_DEFER_KEY);
                },
                deferMonthEndPrompt(previousMonthKey, referenceDate = this.core.Date.getTodayISO()) {
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
                    if (nextValue) {
                        this.monthEndModal.open = true;
                        return;
                    }
                    this.decideMonthEndPromptLater();
                },
                async maybeHandleMonthEndDecision(referenceDate = this.core.Date.getTodayISO()) {
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
                    const previousMonthKey = this.monthEndModal.summary?.previousMonthKey || getPreviousMonthKey(this.core.Date.getTodayISO());
                    this.deferMonthEndPrompt(previousMonthKey, this.core.Date.getTodayISO());
                    this.monthEndModal.open = false;
                    this.monthEndModal.isLoading = false;
                    this.monthEndModal.summary = null;
                },
                async moveMonthEndSurplusToVault() {
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
                    this.deferMonthStartPrompt(this.core.Date.getTodayISO());
                    this.applyTemplatesModal.preview = null;
                    this.applyTemplatesModal.open = false;
                },
                async reviewTemplateApplication() {
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
                async confirmTemplateApplication() {
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
                    this.confirmDialog.open = false;
                },

                resetVaultGoalForm() {
                    this.vaultGoalForm = {
                        name: '',
                        targetAmount: '',
                        allocatedAmount: ''
                    };
                },
                async addVaultGoal() {
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
                async setActiveTemplateProfile(profileId) {
                    const resolvedProfileId = this.templateProfiles.some(profile => profile.id === profileId)
                        ? profileId
                        : (this.templateProfiles[0]?.id || LEGACY_TEMPLATE_PROFILE.id);
                    this.store.settings.activeTemplateProfileId = resolvedProfileId;
                    await DB.setSetting('activeTemplateProfileId', resolvedProfileId);
                    await this.store.refreshFlexibleStats(this.store.currentDate);
                    this.resetApplyTemplatesPreview();
                },
                async createTemplateProfile() {
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
                    this.payModal.item = item;
                    // Reset Numpad string. If paid, show paid amount. If not, show expected.
                    this.payModal.amount = item.isPaid ? item.actualPaid.toString() : item.expectedCost.toString();
                    this.payModal.autoCleared = false; // V2: Track if first input should clear
                    this.payModal.open = true;
                },

                // V3: EDIT EXPENSE / TEMPLATE MODAL LOGIC
                openEditModal(item, type = 'expense') {
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
                async deleteEditedExpense() {
                    if (!this.editModal.item) return;

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
                    this.addModal.form = createAddModalForm();
                    this.addModal.mode = 'expense';
                    this.addModal.open = true;
                },
                async submitNewExpense() {
                    // V2: Prevent double-entry with isSubmitting flag
                    if (this.addModal.isSubmitting) return;
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

                // --- SETTINGS LOGIC ---
                applyTheme(theme) {
                    const resolvedTheme = theme === 'light' ? 'light' : 'dark';
                    this.store.settings.theme = resolvedTheme;
                    document.documentElement.dataset.theme = resolvedTheme;
                    document.documentElement.style.colorScheme = resolvedTheme;
                    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_META_COLORS[resolvedTheme]);
                    localStorage.setItem('rushd_theme', resolvedTheme);
                },
                async setTheme(theme) {
                    const resolvedTheme = theme === 'light' ? 'light' : 'dark';
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
                applyMotionProfile(level) {
                    const resolvedLevel = normalizeMotionLevel(level);
                    const effectiveLevel = this.resolveEffectiveMotionLevel(resolvedLevel);
                    this.store.settings.motionLevel = resolvedLevel;
                    document.documentElement.dataset.motionSetting = resolvedLevel;
                    document.documentElement.dataset.motion = effectiveLevel;
                    localStorage.setItem('rushd_motion', resolvedLevel);
                },
                async setMotionLevel(level) {
                    const resolvedLevel = normalizeMotionLevel(level);
                    this.applyMotionProfile(resolvedLevel);
                    await DB.setSetting('motionLevel', resolvedLevel);
                },
                async saveSettings() {
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
                    // Open the add modal in template mode
                    this.addModal.form = createAddModalForm();
                    this.addModal.mode = 'template';
                    this.addModal.open = true;
                },
                async buildBackupSnapshot() {
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
                importData(event) {
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
                async resetApp() {
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
                    this.lang = newLang;
                    localStorage.setItem('rushd_lang', newLang);
                    this.applyLangDirection();
                },
                setCalendarType(type) {
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
