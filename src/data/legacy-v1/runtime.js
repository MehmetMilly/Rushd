// P02 compatibility boundary. P04 owns migration from MicroSaveOS_DB v1.
import { Core } from '../../shared/core.js';

export function createLegacyDataRuntime({ environment = globalThis, Vue = environment.Vue } = {}) {
    const { localStorage, indexedDB, DOMException, IDBKeyRange } = environment;

        /**
         * ================================================================
         * MODULE: DATABASE (IndexedDB Wrapper)
         * ================================================================
         * A professional-grade wrapper for the browser's SQL-like database.
         * Handles schema upgrades, transactions, and async queries.
         */
        const EXPENSE_SOURCE_VALUES = Object.freeze(['manual', 'template', 'flexible']);

        const DEFINITION_SOURCE_VALUES = Object.freeze(['template', 'flexible']);

        const MOTION_LEVEL_VALUES = Object.freeze(['auto', 'full', 'balanced', 'lite']);

        const toFiniteNumber = (value, fallback = 0) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        const MAX_MONEY_INPUT = 999999999.99;
        const MONEY_DECIMAL_PATTERN = /^(?:\d+)(?:\.\d{1,2})?$/;

        const parseMoneyInput = (value) => {
            if (typeof value === 'number') {
                if (!Number.isFinite(value)) return null;
                return MONEY_DECIMAL_PATTERN.test(String(value)) && value >= 0 && value <= MAX_MONEY_INPUT
                    ? value
                    : null;
            }
            if (typeof value !== 'string') return null;

            const normalized = value.trim()
                .replace(/[\u060C\u066C]/g, ',')
                .replace(/\u066B/g, '.')
                .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, digit => String(
                    digit.charCodeAt(0) >= 0x06F0
                        ? digit.charCodeAt(0) - 0x06F0
                        : digit.charCodeAt(0) - 0x0660
                ));
            if (!normalized || /[^\d.,]/.test(normalized) || (normalized.match(/\./g) || []).length > 1) return null;

            if (normalized.includes(',') && !/^(?:0|[1-9]\d{0,2})(?:,\d{3})+(?:\.\d{1,2})?$/.test(normalized)) return null;

            const amount = Number(normalized.replace(/,/g, ''));
            const canonicalNormalized = normalized.replace(/,/g, '');
            return MONEY_DECIMAL_PATTERN.test(canonicalNormalized)
                && Number.isFinite(amount)
                && amount >= 0
                && amount <= MAX_MONEY_INPUT
                ? amount
                : null;
        };

        // P01 containment only: prototype arithmetic can leave a tiny binary
        // residue (for example 0.1 + 0.2). Persist monetary results at the
        // precision the current UI accepts until P03 introduces halalas.
        const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
        const normalizePersistedMoney = (value, fallback = 0) => {
            const parsed = toFiniteNumber(value, fallback);
            return Number.isFinite(parsed) ? roundMoney(parsed) : fallback;
        };

        const normalizeMotionLevel = (value) => MOTION_LEVEL_VALUES.includes(value) ? value : 'auto';

        const toNonNegativeInteger = (value, fallback = 0) => {
            const parsed = Math.floor(toFiniteNumber(value, fallback));
            return parsed >= 0 ? parsed : fallback;
        };

        const getMonthKey = (dateStr) => typeof dateStr === 'string' && dateStr.length >= 7 ? dateStr.slice(0, 7) : '';

        const toISODate = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

        // P1-01: parse 'YYYY-MM-DD' as a local civil day so local getters
        // (getFullYear/getMonth/getDate/getDay) agree in every timezone.
        const parseLocalCalendarDate = (dateStr) => {
            if (typeof dateStr !== 'string' || !dateStr) return new Date(NaN);
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
            if (!match) return new Date(NaN);
            return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        };

        const DEFAULT_PROFILE_OFFDAYS = Object.freeze([5, 6]);

        const TEMPLATE_APPLICABILITY_VALUES = Object.freeze(['everyday', 'workday', 'offday']);

        const getMonthBoundsFromDate = (dateStr) => {
            const base = dateStr ? parseLocalCalendarDate(dateStr) : new Date();
            if (Number.isNaN(base.getTime())) {
                return { monthKey: '', monthStart: '', monthEnd: '' };
            }

            const year = base.getFullYear();
            const month = base.getMonth();
            const monthStartDate = new Date(year, month, 1);
            const monthEndDate = new Date(year, month + 1, 0);

            return {
                monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
                monthStart: toISODate(monthStartDate),
                monthEnd: toISODate(monthEndDate)
            };
        };

        const getPreviousMonthKey = (dateStr) => {
            const base = dateStr ? parseLocalCalendarDate(dateStr) : new Date();
            if (Number.isNaN(base.getTime())) return '';
            const previousMonthDate = new Date(base.getFullYear(), base.getMonth() - 1, 1);
            return getMonthKey(toISODate(previousMonthDate));
        };

        const isDateInRange = (dateStr, startDate, endDate) => typeof dateStr === 'string' && !!dateStr
            && (!startDate || dateStr >= startDate)
            && (!endDate || dateStr <= endDate);

        const enumerateDateRange = (startDate, endDate) => {
            if (!startDate || !endDate || startDate > endDate) return [];

            const dates = [];
            const cursor = parseLocalCalendarDate(startDate);
            const limit = parseLocalCalendarDate(endDate);

            if (Number.isNaN(cursor.getTime()) || Number.isNaN(limit.getTime())) return [];

            while (cursor <= limit) {
                dates.push(toISODate(cursor));
                cursor.setDate(cursor.getDate() + 1);
            }

            return dates;
        };

        const normalizeWeekdayIndex = (value) => {
            const parsed = Math.floor(Number(value));
            return parsed >= 0 && parsed <= 6 ? parsed : null;
        };

        const normalizeProfileOffdays = (offdays) => {
            const normalized = (Array.isArray(offdays) ? offdays : DEFAULT_PROFILE_OFFDAYS)
                .map(normalizeWeekdayIndex)
                .filter(day => day !== null);
            return [...new Set(normalized)].sort((left, right) => left - right);
        };

        const normalizeTemplateDays = (days) => {
            const normalized = (Array.isArray(days) ? days : [days])
                .map(day => Math.max(1, Math.min(31, toNonNegativeInteger(day, 1))))
                .filter(day => day >= 1 && day <= 31);
            return [...new Set(normalized)].sort((left, right) => left - right);
        };

        // P1-06 review fix: strict day extraction for validation and display.
        // Unlike normalizeTemplateDays, it never invents a fallback day, so a
        // legacy monthly template without a usable schedule stays visibly empty.
        const getValidTemplateDays = (template) => (Array.isArray(template?.days) ? template.days : [])
            .map(day => toNonNegativeInteger(day, NaN))
            .filter(day => Number.isInteger(day) && day >= 1 && day <= 31);

        const hasValidMonthlySchedule = (template) => getValidTemplateDays(template).length > 0;

        const getDateWeekdayIndex = (dateStr) => {
            const base = parseLocalCalendarDate(dateStr);
            if (Number.isNaN(base.getTime())) return null;
            return base.getDay();
        };

        const isProfileOffdayForDate = (profile, dateStr) => {
            const weekdayIndex = getDateWeekdayIndex(dateStr);
            if (weekdayIndex === null) return false;
            const normalizedProfile = normalizeTemplateProfileRecord(profile || LEGACY_TEMPLATE_PROFILE);
            return normalizedProfile ? normalizedProfile.offdays.includes(weekdayIndex) : normalizeProfileOffdays().includes(weekdayIndex);
        };

        const templateMatchesApplicabilityForDate = (template, dateStr, profile = null) => {
            const normalizedTemplate = normalizeDefinitionRecord(template);
            const applicability = TEMPLATE_APPLICABILITY_VALUES.includes(normalizedTemplate.applicability)
                ? normalizedTemplate.applicability
                : 'everyday';
            if (applicability === 'everyday') return true;
            const isOffday = isProfileOffdayForDate(profile, dateStr);
            return applicability === 'offday' ? isOffday : !isOffday;
        };

        const getMonthlyTemplateDays = (template, dateStr) => {
            const base = parseLocalCalendarDate(dateStr);
            if (Number.isNaN(base.getTime())) return [];

            const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
            return [...new Set((Array.isArray(template?.days) ? template.days : [])
                .map(day => Math.min(lastDay, Math.max(1, toNonNegativeInteger(day, 0))))
                .filter(day => day >= 1 && day <= lastDay))];
        };

        const templateOccursOnDate = (template, dateStr, profile = null) => {
            const normalizedTemplate = normalizeDefinitionRecord(template);
            if (isFlexibleDefinitionRecord(normalizedTemplate)) return false;
            if (normalizedTemplate.recurrence === 'daily') return templateMatchesApplicabilityForDate(normalizedTemplate, dateStr, profile);
            if (normalizedTemplate.recurrence === 'monthly') {
                const base = parseLocalCalendarDate(dateStr);
                if (Number.isNaN(base.getTime())) return false;
                return getMonthlyTemplateDays(normalizedTemplate, dateStr).includes(base.getDate());
            }
            return false;
        };

        const compareExpensePriority = (left, right) => {
            const paidDiff = Number(!!right?.isPaid) - Number(!!left?.isPaid);
            if (paidDiff !== 0) return paidDiff;

            const timestampDiff = toFiniteNumber(left?.timestamp, 0) - toFiniteNumber(right?.timestamp, 0);
            if (timestampDiff !== 0) return timestampDiff;

            return String(left?.id || '').localeCompare(String(right?.id || ''));
        };

        const matchesTemplateFallbackShape = (expense, template, dateStr) => {
            const normalizedExpense = normalizeExpenseRecord(expense);
            const normalizedTemplate = normalizeDefinitionRecord(template);
            return normalizedExpense.date === dateStr
                && normalizedExpense.name === normalizedTemplate.name
                && toFiniteNumber(normalizedExpense.expectedCost, 0) === toFiniteNumber(normalizedTemplate.expectedCost, normalizedTemplate.defaultAmount || 0)
                && (normalizedExpense.category || '') === (normalizedTemplate.category || '')
                && (normalizedExpense.classification || 'essential') === (normalizedTemplate.classification || 'essential');
        };

        const findTemplateExpenseMatch = (expenses, template, dateStr, usedExpenseIds = new Set()) => {
            const normalizedTemplate = normalizeDefinitionRecord(template);
            const availableExpenses = (expenses || []).filter(expense => !usedExpenseIds.has(expense.id));
            const originMatches = availableExpenses
                .filter(expense => normalizedTemplate.id && expense.templateOriginId === normalizedTemplate.id)
                .sort(compareExpensePriority);
            if (originMatches.length > 0) return originMatches[0];

            const fallbackMatches = availableExpenses
                .filter(expense => matchesTemplateFallbackShape(expense, normalizedTemplate, dateStr))
                .sort(compareExpensePriority);
            return fallbackMatches[0] || null;
        };

        const buildTemplateExpenseFromDefinition = (template, dateStr, existingExpense = null) => {
            const normalizedTemplate = normalizeDefinitionRecord(template);
            return normalizeExpenseRecord({
                ...(existingExpense || {}),
                id: existingExpense?.id || Core.UUID(),
                name: normalizedTemplate.name,
                expectedCost: toFiniteNumber(normalizedTemplate.expectedCost ?? normalizedTemplate.defaultAmount, 0),
                actualPaid: toFiniteNumber(existingExpense?.actualPaid, 0),
                isPaid: !!existingExpense?.isPaid,
                category: normalizedTemplate.category,
                classification: normalizedTemplate.classification || existingExpense?.classification || 'essential',
                source: 'template',
                templateOriginId: normalizedTemplate.id || existingExpense?.templateOriginId || null,
                flexibleDefinitionId: null,
                date: dateStr,
                timestamp: existingExpense?.timestamp || Date.now(),
                templateProtected: false
            });
        };

        const didTemplateExpenseRebuildChange = (originalExpense, rebuiltExpense) => {
            const original = normalizeExpenseRecord(originalExpense);
            const rebuilt = normalizeExpenseRecord(rebuiltExpense);
            return original.name !== rebuilt.name
                || toFiniteNumber(original.expectedCost, 0) !== toFiniteNumber(rebuilt.expectedCost, 0)
                || (original.category || '') !== (rebuilt.category || '')
                || (original.classification || 'essential') !== (rebuilt.classification || 'essential')
                || (original.templateOriginId || null) !== (rebuilt.templateOriginId || null)
                || original.date !== rebuilt.date
                || original.source !== rebuilt.source
                || original.templateProtected !== rebuilt.templateProtected;
        };

        const LEGACY_TEMPLATE_PROFILE = Object.freeze({ id: 'legacy', name: 'Legacy', offdays: Object.freeze([...DEFAULT_PROFILE_OFFDAYS]) });

        const MONTH_START_PROMPT_DEFER_KEY = 'rushd_month_start_prompt_deferred';
        const MONTH_END_PROMPT_DEFER_KEY = 'rushd_month_end_prompt_deferred';
        const ONBOARDING_STATE_KEY = 'onboardingState';
        const ONBOARDING_STATUS_VALUES = ['skipped', 'completed'];
        const MONTH_END_SETTLEMENT_DECISIONS = ['vault', 'budget', 'no_surplus'];

        const normalizeTemplateProfileRecord = (profile) => {
            const id = typeof profile?.id === 'string' && profile.id.trim()
                ? profile.id.trim()
                : '';
            if (!id) return null;
            const name = typeof profile?.name === 'string' && profile.name.trim()
                ? profile.name.trim()
                : id;
            const offdays = normalizeProfileOffdays(profile?.offdays ?? profile?.offDays);
            return { id, name, offdays };
        };

        const normalizeTemplateProfiles = (profiles) => {
            const seen = new Set();
            const normalized = [];
            const addProfile = (profile) => {
                const normalizedProfile = normalizeTemplateProfileRecord(profile);
                if (!normalizedProfile || seen.has(normalizedProfile.id)) return;
                seen.add(normalizedProfile.id);
                normalized.push(normalizedProfile);
            };

            (Array.isArray(profiles) ? profiles : []).forEach(addProfile);
            if (!seen.has(LEGACY_TEMPLATE_PROFILE.id)) {
                addProfile(LEGACY_TEMPLATE_PROFILE);
            }
            const legacyProfile = normalized.find(profile => profile.id === LEGACY_TEMPLATE_PROFILE.id)
                || normalizeTemplateProfileRecord(LEGACY_TEMPLATE_PROFILE);
            const otherProfiles = normalized.filter(profile => profile.id !== LEGACY_TEMPLATE_PROFILE.id);
            return [legacyProfile, ...otherProfiles];
        };

        const getTemplateProfileRecordById = (profiles, profileId = LEGACY_TEMPLATE_PROFILE.id) => {
            const resolvedProfileId = getDefinitionProfileId({ profileId }, LEGACY_TEMPLATE_PROFILE.id);
            const storedProfile = (Array.isArray(profiles) ? profiles : []).find(profile => normalizeTemplateProfileRecord(profile)?.id === resolvedProfileId);
            return normalizeTemplateProfileRecord(storedProfile || { id: resolvedProfileId, name: resolvedProfileId });
        };

        const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

        const normalizeMonthlyTemplateAssignmentRecord = (assignment) => {
            const rawMonthKey = typeof assignment?.monthKey === 'string' && MONTH_KEY_PATTERN.test(assignment.monthKey.trim())
                ? assignment.monthKey.trim()
                : '';
            const monthKey = rawMonthKey || getMonthKey(assignment?.effectiveDate || '');
            if (!MONTH_KEY_PATTERN.test(monthKey)) return null;

            const { monthStart, monthEnd } = getMonthBoundsFromDate(`${monthKey}-01`);
            const assignedProfileId = getDefinitionProfileId({ profileId: assignment?.assignedProfileId ?? assignment?.profileId }, '');
            if (!monthStart || !monthEnd || !assignedProfileId) return null;

            const rawEffectiveDate = typeof assignment?.effectiveDate === 'string' && assignment.effectiveDate
                ? assignment.effectiveDate
                : monthStart;
            const effectiveDate = isDateInRange(rawEffectiveDate, monthStart, monthEnd) ? rawEffectiveDate : monthStart;

            return {
                monthKey,
                assignedProfileId,
                effectiveDate
            };
        };

        const normalizeMonthlyTemplateAssignments = (assignments) => {
            const byMonthKey = new Map();
            (Array.isArray(assignments) ? assignments : []).forEach(assignment => {
                const normalizedAssignment = normalizeMonthlyTemplateAssignmentRecord(assignment);
                if (!normalizedAssignment) return;
                byMonthKey.set(normalizedAssignment.monthKey, normalizedAssignment);
            });
            return Array.from(byMonthKey.values()).sort((left, right) => left.monthKey.localeCompare(right.monthKey));
        };

        // P1-03: monthKey -> base allowance snapshots. Entries are recorded while
        // a month is live and are never rewritten by later allowance changes.
        const normalizeMonthlyBaseAllowances = (value) => {
            if (!isPlainObjectRecord(value)) return {};
            const normalized = {};
            for (const [monthKey, amount] of Object.entries(value)) {
                if (!MONTH_KEY_PATTERN.test(monthKey || '')) continue;
                const parsed = toFiniteNumber(amount, NaN);
                if (Number.isFinite(parsed) && parsed >= 0) normalized[monthKey] = parsed;
            }
            return normalized;
        };

        const normalizeOnboardingStateRecord = (state) => {
            if (!state || typeof state !== 'object') return null;
            const status = ONBOARDING_STATUS_VALUES.includes(state.status) ? state.status : '';
            if (!status) return null;
            return {
                status,
                updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : '',
                source: typeof state.source === 'string' ? state.source : ''
            };
        };

        const normalizeVaultGoalRecord = (goal) => {
            if (!goal || typeof goal !== 'object') return null;
            const id = typeof goal.id === 'string' && goal.id.trim()
                ? goal.id.trim()
                : '';
            const name = typeof goal.name === 'string' && goal.name.trim()
                ? goal.name.trim()
                : '';
            const targetAmount = Math.max(0, normalizePersistedMoney(goal.targetAmount ?? goal.target, 0));
            const allocatedAmount = Math.max(0, normalizePersistedMoney(goal.allocatedAmount ?? goal.allocation, 0));
            if (!id || !name || targetAmount <= 0) return null;
            return {
                id,
                name,
                targetAmount,
                allocatedAmount: Math.min(targetAmount, allocatedAmount)
            };
        };

        const normalizeVaultGoals = (goals) => {
            const seen = new Set();
            return (Array.isArray(goals) ? goals : [])
                .map(normalizeVaultGoalRecord)
                .filter(goal => {
                    if (!goal || seen.has(goal.id)) return false;
                    seen.add(goal.id);
                    return true;
                });
        };

        const normalizeVaultTransactionRecord = (transaction) => {
            if (!transaction || typeof transaction !== 'object') return null;
            const amount = normalizePersistedMoney(transaction.amount, 0);
            const date = typeof transaction.date === 'string' && transaction.date ? transaction.date : '';
            const monthKey = typeof transaction.monthKey === 'string' && MONTH_KEY_PATTERN.test(transaction.monthKey)
                ? transaction.monthKey
                : getMonthKey(date);
            const sourceMonthKey = typeof transaction.sourceMonthKey === 'string' && MONTH_KEY_PATTERN.test(transaction.sourceMonthKey)
                ? transaction.sourceMonthKey
                : '';
            if (amount <= 0 || !date) return null;
            return {
                id: typeof transaction.id === 'string' && transaction.id ? transaction.id : `vault-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                type: 'surplus_transfer',
                amount,
                date,
                monthKey,
                sourceMonthKey,
                createdAt: typeof transaction.createdAt === 'string' && transaction.createdAt ? transaction.createdAt : new Date(`${date}T00:00:00`).toISOString()
            };
        };

        const normalizeVaultStateRecord = (vault) => {
            const transactions = (Array.isArray(vault?.transactions) ? vault.transactions : [])
                .map(normalizeVaultTransactionRecord)
                .filter(Boolean)
                .sort((left, right) => String(right.createdAt || right.date).localeCompare(String(left.createdAt || left.date)));
            const goals = normalizeVaultGoals(vault?.goals);
            const computedBalance = normalizePersistedMoney(transactions.reduce((sum, transaction) => sum + transaction.amount, 0));
            const legacyOpeningBalance = Math.max(0, normalizePersistedMoney(
                toFiniteNumber(vault?.balance, computedBalance) - computedBalance
            ));
            // Legacy source selection remains: transactions.length > 0 ? legacyOpeningBalance : Math.max(0, toFiniteNumber(vault?.balance, computedBalance)).
            const fallbackOpening = transactions.length > 0 ? legacyOpeningBalance : Math.max(0, normalizePersistedMoney(vault?.balance, computedBalance));
            const openingBalance = Math.max(0, normalizePersistedMoney(vault?.openingBalance, fallbackOpening));
            return {
                balance: normalizePersistedMoney(openingBalance + computedBalance),
                transactions,
                openingBalance,
                goals
            };
        };

        const normalizeMonthEndSettlementRecord = (settlement) => {
            if (!settlement || typeof settlement !== 'object') return null;
            const previousMonthKey = typeof settlement.previousMonthKey === 'string' && MONTH_KEY_PATTERN.test(settlement.previousMonthKey)
                ? settlement.previousMonthKey
                : '';
            const decision = MONTH_END_SETTLEMENT_DECISIONS.includes(settlement.decision) ? settlement.decision : '';
            if (!previousMonthKey || !decision) return null;
            const targetMonthKey = typeof settlement.targetMonthKey === 'string' && MONTH_KEY_PATTERN.test(settlement.targetMonthKey)
                ? settlement.targetMonthKey
                : '';
            return {
                previousMonthKey,
                decision,
                targetMonthKey: decision === 'budget' ? targetMonthKey : '',
                surplus: Math.max(0, normalizePersistedMoney(settlement.surplus, 0)),
                previousMonthBudget: Math.max(0, normalizePersistedMoney(settlement.previousMonthBudget, 0)),
                previousMonthSpent: Math.max(0, normalizePersistedMoney(settlement.previousMonthSpent, 0)),
                settledAt: typeof settlement.settledAt === 'string' ? settlement.settledAt : '',
                vaultTransactionId: typeof settlement.vaultTransactionId === 'string' ? settlement.vaultTransactionId : ''
            };
        };

        const normalizeMonthEndSettlements = (settlements) => {
            const byMonthKey = new Map();
            (Array.isArray(settlements) ? settlements : []).forEach(settlement => {
                const normalized = normalizeMonthEndSettlementRecord(settlement);
                if (!normalized) return;
                byMonthKey.set(normalized.previousMonthKey, normalized);
            });
            return Array.from(byMonthKey.values()).sort((left, right) => left.previousMonthKey.localeCompare(right.previousMonthKey));
        };

        const getDefinitionProfileId = (definition, fallbackProfileId = LEGACY_TEMPLATE_PROFILE.id) => {
            const profileId = typeof definition?.profileId === 'string' && definition.profileId.trim()
                ? definition.profileId.trim()
                : '';
            return profileId || fallbackProfileId;
        };

        const isDefinitionInProfile = (definition, profileId) => {
            return normalizeDefinitionRecord(definition).profileId === getDefinitionProfileId({ profileId });
        };

        const normalizeDefinitionRecord = (definition) => {
            const source = DEFINITION_SOURCE_VALUES.includes(definition?.source) ? definition.source : 'template';
            const defaultAmount = normalizePersistedMoney(definition?.defaultAmount ?? definition?.expectedCost ?? 0, 0);
            const monthlyBudget = normalizePersistedMoney(definition?.monthlyBudget ?? definition?.expectedCost ?? 0, 0);
            const maxUsesPerMonth = toNonNegativeInteger(definition?.maxUsesPerMonth ?? 0, 0);
            const profileId = getDefinitionProfileId(definition);
            const recurrence = definition?.recurrence === 'monthly' ? 'monthly' : 'daily';
            const applicability = recurrence === 'daily' && TEMPLATE_APPLICABILITY_VALUES.includes(definition?.applicability)
                ? definition.applicability
                : 'everyday';

            return {
                ...(definition || {}),
                ...(definition?.expectedCost !== undefined ? { expectedCost: normalizePersistedMoney(definition.expectedCost, 0) } : {}),
                source,
                defaultAmount,
                monthlyBudget,
                maxUsesPerMonth,
                profileId,
                recurrence,
                applicability
            };
        };

        const isFlexibleDefinitionRecord = (definition) => normalizeDefinitionRecord(definition).source === 'flexible';

        const toSerializableValue = (value) => {
            if (value === undefined) return undefined;
            return JSON.parse(JSON.stringify(value));
        };

        const getExpenseTemplateOriginId = (expense, source) => {
            const templateOriginId = typeof expense?.templateOriginId === 'string' && expense.templateOriginId.trim()
                ? expense.templateOriginId.trim()
                : null;
            if (templateOriginId) return templateOriginId;

            const flexibleDefinitionId = typeof expense?.flexibleDefinitionId === 'string' && expense.flexibleDefinitionId.trim()
                ? expense.flexibleDefinitionId.trim()
                : null;
            if (source === 'flexible' && flexibleDefinitionId) return flexibleDefinitionId;

            return null;
        };

        const getExpenseTemplateProtection = (expense, source) => {
            if (typeof expense?.templateProtected === 'boolean') return expense.templateProtected;
            return source !== 'template';
        };

        const didExpenseStructureChange = (originalExpense, updatedExpense) => {
            return (originalExpense?.name ?? '') !== (updatedExpense?.name ?? '')
                || toFiniteNumber(originalExpense?.expectedCost, 0) !== toFiniteNumber(updatedExpense?.expectedCost, 0)
                || (originalExpense?.category ?? '') !== (updatedExpense?.category ?? '')
                || (originalExpense?.date ?? '') !== (updatedExpense?.date ?? '')
                || (originalExpense?.classification ?? 'essential') !== (updatedExpense?.classification ?? 'essential');
        };

        const normalizeExpenseRecord = (expense) => {
            const source = EXPENSE_SOURCE_VALUES.includes(expense?.source) ? expense.source : 'manual';
            const templateOriginId = getExpenseTemplateOriginId(expense, source);
            const flexibleDefinitionId = typeof expense?.flexibleDefinitionId === 'string' && expense.flexibleDefinitionId.trim()
                ? expense.flexibleDefinitionId.trim()
                : (source === 'flexible' ? templateOriginId : null);
            return {
                ...(expense || {}),
                ...(expense?.expectedCost !== undefined ? { expectedCost: normalizePersistedMoney(expense.expectedCost, 0) } : {}),
                ...(expense?.actualPaid !== undefined ? { actualPaid: normalizePersistedMoney(expense.actualPaid, 0) } : {}),
                source,
                flexibleDefinitionId,
                templateOriginId,
                templateProtected: getExpenseTemplateProtection(expense, source)
            };
        };

        // P1-10: strict structural gate for imported backups. Runs before any
        // canonical store is touched so malformed payloads are rejected whole.
        // Valid Rushd exports, including legacy local backups, still pass.
        const BACKUP_EXPENSE_MONEY_FIELDS = Object.freeze(['expectedCost', 'actualPaid']);
        const isPlainObjectRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
        const isValidBackupMoneyValue = (value) => {
            if (parseMoneyInput(value) !== null) return true;
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MONEY_INPUT) return false;
            return Math.abs(value - roundMoney(value)) <= 1e-8;
        };
        const isValidIsoDateString = (value) => {
            if (typeof value !== 'string') return false;
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
            if (!match) return false;
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            const date = new Date(Date.UTC(year, month - 1, day));
            return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
        };
        const isValidTimestampString = (value) => typeof value === 'string' && !!value && !Number.isNaN(Date.parse(value));
        const hasDuplicateRecordIds = (records, field = 'id') => {
            const seen = new Set();
            return records.some(record => {
                const value = record?.[field];
                if (seen.has(value)) return true;
                seen.add(value);
                return false;
            });
        };

        const validateBackupPayload = (payload) => {
            if (!isPlainObjectRecord(payload)) return { ok: false, reason: 'payload' };
            if (payload.version !== undefined && typeof payload.version !== 'string') return { ok: false, reason: 'version' };
            if (payload.exportedAt !== undefined
                && (typeof payload.exportedAt !== 'string' || Number.isNaN(Date.parse(payload.exportedAt)))) {
                return { ok: false, reason: 'exportedAt' };
            }
            if (!Array.isArray(payload.expenses)) return { ok: false, reason: 'expenses' };

            if (payload.settings !== undefined) {
                const settings = payload.settings;
                if (!isPlainObjectRecord(settings)) return { ok: false, reason: 'settings' };
                if (settings.baseAllowance !== undefined && !isValidBackupMoneyValue(settings.baseAllowance)) {
                    return { ok: false, reason: 'settings.baseAllowance' };
                }
                if (settings.safeToSpendMode !== undefined && !['weekly', 'monthly'].includes(settings.safeToSpendMode)) {
                    return { ok: false, reason: 'settings.safeToSpendMode' };
                }
                if (settings.theme !== undefined && !['dark', 'light'].includes(settings.theme)) {
                    return { ok: false, reason: 'settings.theme' };
                }
                if (settings.motionLevel !== undefined && !MOTION_LEVEL_VALUES.includes(settings.motionLevel)) {
                    return { ok: false, reason: 'settings.motionLevel' };
                }
                if (settings.activeTemplateProfileId !== undefined && typeof settings.activeTemplateProfileId !== 'string') {
                    return { ok: false, reason: 'settings.activeTemplateProfileId' };
                }
                if (settings.templateProfiles !== undefined) {
                    if (!Array.isArray(settings.templateProfiles)) return { ok: false, reason: 'settings.templateProfiles' };
                    for (const profile of settings.templateProfiles) {
                        if (!isPlainObjectRecord(profile) || typeof profile.id !== 'string' || !profile.id.trim()) {
                            return { ok: false, reason: 'settings.templateProfiles' };
                        }
                    }
                    if (hasDuplicateRecordIds(settings.templateProfiles)) return { ok: false, reason: 'settings.templateProfiles' };
                }
                if (settings.monthlyTemplateAssignments !== undefined) {
                    if (!Array.isArray(settings.monthlyTemplateAssignments)) return { ok: false, reason: 'settings.monthlyTemplateAssignments' };
                    for (const assignment of settings.monthlyTemplateAssignments) {
                        if (!isPlainObjectRecord(assignment)
                            || !MONTH_KEY_PATTERN.test(assignment.monthKey || '')
                            || typeof assignment.assignedProfileId !== 'string'
                            || !isValidIsoDateString(assignment.effectiveDate)
                            || !isDateInRange(assignment.effectiveDate, `${assignment.monthKey}-01`, getMonthBoundsFromDate(`${assignment.monthKey}-01`).monthEnd)) {
                            return { ok: false, reason: 'settings.monthlyTemplateAssignments' };
                        }
                    }
                    if (hasDuplicateRecordIds(settings.monthlyTemplateAssignments, 'monthKey')) return { ok: false, reason: 'settings.monthlyTemplateAssignments' };
                }
                if (settings.vault !== undefined) {
                    const vault = settings.vault;
                    if (!isPlainObjectRecord(vault)
                        || !Array.isArray(vault.transactions)
                        || (vault.goals !== undefined && vault.goals !== null && !Array.isArray(vault.goals))
                        || (vault.balance !== undefined && !isValidBackupMoneyValue(vault.balance))
                        || (vault.openingBalance !== undefined && !isValidBackupMoneyValue(vault.openingBalance))) {
                        return { ok: false, reason: 'settings.vault' };
                    }
                    for (const vaultTransaction of vault.transactions) {
                        if (!isPlainObjectRecord(vaultTransaction)
                            || typeof vaultTransaction.id !== 'string'
                            || !vaultTransaction.id
                            || !isValidBackupMoneyValue(vaultTransaction.amount)
                            || normalizePersistedMoney(vaultTransaction.amount) <= 0
                            || !isValidIsoDateString(vaultTransaction.date)
                            || (vaultTransaction.type !== undefined && vaultTransaction.type !== 'surplus_transfer')
                            || (vaultTransaction.monthKey !== undefined
                                && (!MONTH_KEY_PATTERN.test(vaultTransaction.monthKey)
                                    || vaultTransaction.monthKey !== getMonthKey(vaultTransaction.date)))
                            || (vaultTransaction.sourceMonthKey !== undefined && !MONTH_KEY_PATTERN.test(vaultTransaction.sourceMonthKey))
                            || (vaultTransaction.createdAt !== undefined && !isValidTimestampString(vaultTransaction.createdAt))) {
                            return { ok: false, reason: 'settings.vault.transactions' };
                        }
                    }
                    if (hasDuplicateRecordIds(vault.transactions)) return { ok: false, reason: 'settings.vault.transactions' };
                    if (Array.isArray(vault.goals)) {
                        let allocatedTotal = 0;
                        for (const goal of vault.goals) {
                            const allocation = goal?.allocatedAmount ?? goal?.allocation ?? 0;
                            if (!isPlainObjectRecord(goal)
                                || typeof goal.id !== 'string'
                                || !goal.id.trim()
                                || typeof goal.name !== 'string'
                                || !goal.name.trim()
                                || !isValidBackupMoneyValue(goal.targetAmount ?? goal.target)
                                || normalizePersistedMoney(goal.targetAmount ?? goal.target) <= 0
                                || !isValidBackupMoneyValue(allocation)
                                || normalizePersistedMoney(allocation) > normalizePersistedMoney(goal.targetAmount ?? goal.target)) {
                                return { ok: false, reason: 'settings.vault.goals' };
                            }
                            allocatedTotal = normalizePersistedMoney(allocatedTotal + normalizePersistedMoney(allocation));
                        }
                        const normalizedVaultBalance = normalizeVaultStateRecord(vault).balance;
                        if (hasDuplicateRecordIds(vault.goals)
                            || allocatedTotal > normalizedVaultBalance) {
                            return { ok: false, reason: 'settings.vault.goals' };
                        }
                    }
                }
                if (settings.monthEndSettlements !== undefined) {
                    if (!Array.isArray(settings.monthEndSettlements)) return { ok: false, reason: 'settings.monthEndSettlements' };
                    for (const item of settings.monthEndSettlements) {
                        if (!isPlainObjectRecord(item)
                            || !MONTH_KEY_PATTERN.test(item.previousMonthKey || '')
                            || !MONTH_END_SETTLEMENT_DECISIONS.includes(item.decision)
                            || ['surplus', 'previousMonthBudget', 'previousMonthSpent'].some(field => !isValidBackupMoneyValue(item[field]))) {
                            return { ok: false, reason: 'settings.monthEndSettlements' };
                        }
                    }
                    if (hasDuplicateRecordIds(settings.monthEndSettlements, 'previousMonthKey')) return { ok: false, reason: 'settings.monthEndSettlements' };
                }
                if (settings.monthlyBaseAllowances !== undefined) {
                    if (!isPlainObjectRecord(settings.monthlyBaseAllowances)) return { ok: false, reason: 'settings.monthlyBaseAllowances' };
                    for (const [monthKey, amount] of Object.entries(settings.monthlyBaseAllowances)) {
                        if (!MONTH_KEY_PATTERN.test(monthKey || '') || !isValidBackupMoneyValue(amount)) {
                            return { ok: false, reason: 'settings.monthlyBaseAllowances' };
                        }
                    }
                }
            }

            if (payload.templates !== undefined) {
                if (!Array.isArray(payload.templates)) return { ok: false, reason: 'templates' };
                for (const template of payload.templates) {
                    if (!isPlainObjectRecord(template)
                        || typeof template.id !== 'string'
                        || !template.id.trim()
                        || typeof template.name !== 'string'
                        || !template.name.trim()
                        || (template.expectedCost !== undefined && !isValidBackupMoneyValue(template.expectedCost))
                        || (template.defaultAmount !== undefined && !isValidBackupMoneyValue(template.defaultAmount))) {
                        return { ok: false, reason: 'templates' };
                    }
                    // P1-06: an imported monthly template without an explicit valid
                    // occurrence day would sit silently with zero occurrences.
                    if ((template.recurrence || 'daily') === 'monthly') {
                        const days = Array.isArray(template.days) ? template.days : [];
                        if (days.length === 0 || days.some(day => !Number.isInteger(day) || day < 1 || day > 31)) {
                            return { ok: false, reason: 'templates.monthlyDays' };
                        }
                    }
                }
                if (hasDuplicateRecordIds(payload.templates)) return { ok: false, reason: 'templates' };
            }

            for (const expense of payload.expenses) {
                if (!isPlainObjectRecord(expense)
                    || typeof expense.id !== 'string'
                    || !expense.id.trim()
                    || !isValidIsoDateString(expense.date)
                    || (expense.name !== undefined && typeof expense.name !== 'string')
                    || (expense.isPaid !== undefined && typeof expense.isPaid !== 'boolean')
                    || (expense.source !== undefined && !EXPENSE_SOURCE_VALUES.includes(expense.source))
                    || BACKUP_EXPENSE_MONEY_FIELDS.some(field => expense[field] !== undefined && !isValidBackupMoneyValue(expense[field]))) {
                    return { ok: false, reason: 'expenses' };
                }
            }
            if (hasDuplicateRecordIds(payload.expenses)) return { ok: false, reason: 'expenses' };

            return { ok: true, reason: '' };
        };

        const DB = {
                dbName: 'MicroSaveOS_DB', // Legacy database name preserved so existing local users do not lose data.
            version: 1,
            db: null,
            _settlementWriteQueue: Promise.resolve(),

            async connect() {
                return new Promise((resolve, reject) => {
                    const request = indexedDB.open(this.dbName, this.version);

                    request.onupgradeneeded = (event) => {
                        const db = event.target.result;

                        // Store 1: Settings (Key-Value)
                        if (!db.objectStoreNames.contains('settings')) {
                            db.createObjectStore('settings', { keyPath: 'key' });
                        }

                        // Store 2: Templates (Recurring Rules)
                        if (!db.objectStoreNames.contains('templates')) {
                            db.createObjectStore('templates', { keyPath: 'id' });
                        }

                        // Store 3: Expenses (The massive transaction log)
                        // We index by 'date' for fast queries on the calendar view
                        if (!db.objectStoreNames.contains('expenses')) {
                            const store = db.createObjectStore('expenses', { keyPath: 'id' });
                            store.createIndex('date', 'date', { unique: false });
                            store.createIndex('isPaid', 'isPaid', { unique: false });
                        }
                    };

                    request.onsuccess = (event) => {
                        this.db = event.target.result;
                        console.log("✅ Database Connected: " + this.dbName);
                        resolve(this.db);
                    };

                    request.onerror = (event) => {
                        console.error("❌ Database Error:", event.target.error);
                        reject(event.target.error);
                    };
                });
            },

            // --- GENERIC HELPER: TRANSACTION WRAPPER ---
            // Resilient: auto-reconnects if DB connection is stale or closed
            async transaction(storeName, mode, callback) {
                if (!this.db) await this.connect();
                try {
                    return await new Promise((resolve, reject) => {
                        const tx = this.db.transaction(storeName, mode);
                        const store = tx.objectStore(storeName);
                        const request = callback(store);
                        tx.oncomplete = () => resolve(request.result);
                        tx.onerror = () => reject(tx.error);
                    });
                } catch (e) {
                    // If connection was closed/stale, reconnect and retry once
                    if (e.name === 'InvalidStateError') {
                        console.warn('⚠️ DB connection stale, reconnecting...');
                        this.db = null;
                        await this.connect();
                        return new Promise((resolve, reject) => {
                            const tx = this.db.transaction(storeName, mode);
                            const store = tx.objectStore(storeName);
                            const request = callback(store);
                            tx.oncomplete = () => resolve(request.result);
                            tx.onerror = () => reject(tx.error);
                        });
                    }
                    throw e;
                }
            },

            // --- API METHODS ---

            // Settings
            async getSetting(key, defaultValue) {
                try {
                    const result = await this.transaction('settings', 'readonly', store => store.get(key));
                    return result ? result.value : defaultValue;
                } catch (e) { return defaultValue; }
            },

            async setSetting(key, value) {
                const serializableValue = toSerializableValue(value);
                return this.transaction('settings', 'readwrite', store => store.put({ key, value: serializableValue }));
            },

            // Templates
            async getTemplates() {
                const result = await this.transaction('templates', 'readonly', store => store.getAll());
                return (result || []).map(normalizeDefinitionRecord);
            },

            async saveTemplate(template) {
                return this.transaction('templates', 'readwrite', store => store.put(toSerializableValue(normalizeDefinitionRecord(template))));
            },

            async deleteTemplate(id) {
                return this.transaction('templates', 'readwrite', store => store.delete(id));
            },

            // Expenses
            async getExpensesByDate(dateStr) {
                const result = await this.transaction('expenses', 'readonly', store => {
                    const index = store.index('date');
                    return index.getAll(IDBKeyRange.only(dateStr));
                });
                return (result || []).map(normalizeExpenseRecord);
            },

            async getAllExpenses() {
                const result = await this.transaction('expenses', 'readonly', store => store.getAll());
                return (result || []).map(normalizeExpenseRecord);
            },

            async saveExpense(expense) {
                return this.transaction('expenses', 'readwrite', store => store.put(toSerializableValue(normalizeExpenseRecord(expense))));
            },

            async deleteExpense(id) {
                return this.transaction('expenses', 'readwrite', store => store.delete(id));
            },

            // --- ATOMIC MULTI-STORE WRITES ---
            // Every request issued inside the callback commits together or not at
            // all. Used by plan apply, cycle settlement, and backup import so a
            // mid-operation failure can never leave a partial write behind.
            async multiStoreTransaction(storeNames, mode, callback) {
                if (!this.db) await this.connect();
                const attempt = () => new Promise((resolve, reject) => {
                    const tx = this.db.transaction(storeNames, mode);
                    const request = callback(tx);
                    tx.oncomplete = () => resolve(request ? request.result : undefined);
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error || new DOMException('IndexedDB transaction aborted', 'AbortError'));
                });
                try {
                    return await attempt();
                } catch (e) {
                    // If connection was closed/stale, reconnect and retry once
                    if (e.name === 'InvalidStateError') {
                        console.warn('⚠️ DB connection stale, reconnecting...');
                        this.db = null;
                        await this.connect();
                        return attempt();
                    }
                    throw e;
                }
            },

            // Writes several settings keys inside one atomic transaction.
            async setSettingsEntries(entries) {
                return this.multiStoreTransaction(['settings'], 'readwrite', tx => {
                    const store = tx.objectStore('settings');
                    let lastRequest = null;
                    for (const entry of entries) {
                        lastRequest = store.put({ key: entry.key, value: toSerializableValue(entry.value) });
                    }
                    return lastRequest;
                });
            },

            // Applies a plan-apply write batch (expense deletes/puts plus optional
            // settings entries) in one atomic transaction.
            async applyExpenseWritePlan({ deletes = [], puts = [], settingsEntries = [] } = {}) {
                const storeNames = settingsEntries.length > 0 ? ['expenses', 'settings'] : ['expenses'];
                return this.multiStoreTransaction(storeNames, 'readwrite', tx => {
                    const expenses = tx.objectStore('expenses');
                    let lastRequest = null;
                    for (const id of deletes) {
                        lastRequest = expenses.delete(id);
                    }
                    for (const expense of puts) {
                        lastRequest = expenses.put(toSerializableValue(normalizeExpenseRecord(expense)));
                    }
                    if (settingsEntries.length > 0) {
                        const settings = tx.objectStore('settings');
                        for (const entry of settingsEntries) {
                            lastRequest = settings.put({ key: entry.key, value: toSerializableValue(entry.value) });
                        }
                    }
                    return lastRequest;
                });
            },

            // Restores a validated backup in one atomic transaction across all
            // stores: settings keys, templates, and expenses commit together.
            async restoreBackupRecords({ settingsEntries = [], templates = [], expenses = [] } = {}) {
                return this.multiStoreTransaction(['settings', 'templates', 'expenses'], 'readwrite', tx => {
                    const settings = tx.objectStore('settings');
                    const templateStore = tx.objectStore('templates');
                    const expenseStore = tx.objectStore('expenses');
                    let lastRequest = null;
                    for (const entry of settingsEntries) {
                        lastRequest = settings.put({ key: entry.key, value: toSerializableValue(entry.value) });
                    }
                    for (const template of templates) {
                        lastRequest = templateStore.put(toSerializableValue(normalizeDefinitionRecord(template)));
                    }
                    for (const expense of expenses) {
                        lastRequest = expenseStore.put(toSerializableValue(normalizeExpenseRecord(expense)));
                    }
                    return lastRequest;
                });
            },

            // Resolve a cycle choice from the values read inside the same
            // IndexedDB transaction that writes it. The queue closes the
            // in-process gap before a second request can observe stale state;
            // IndexedDB serializes the actual readwrite transaction. This
            // supersedes the former DB.setSettingsEntries(...) write batch.
            async resolveMonthEndSettlement({ previousMonthKey, decision, targetMonthKey, surplus, previousMonthBudget, previousMonthSpent, referenceDate } = {}) {
                if (!MONTH_KEY_PATTERN.test(previousMonthKey || '')
                    || !MONTH_END_SETTLEMENT_DECISIONS.includes(decision)
                    || (decision !== 'no_surplus' && (!MONTH_KEY_PATTERN.test(targetMonthKey || '') || surplus <= 0))) {
                    return null;
                }

                const operation = this._settlementWriteQueue.then(() => new Promise((resolve, reject) => {
                    const tx = this.db.transaction(['settings'], 'readwrite');
                    const settings = tx.objectStore('settings');
                    const vaultRequest = settings.get('vault');
                    const settlementsRequest = settings.get('monthEndSettlements');
                    let vaultValue;
                    let settlementsValue;
                    let hasVaultValue = false;
                    let hasSettlementsValue = false;
                    let result = null;

                    const writeResolution = () => {
                        if (!hasVaultValue || !hasSettlementsValue) return;
                        const vault = normalizeVaultStateRecord(vaultValue?.value);
                        const settlements = normalizeMonthEndSettlements(settlementsValue?.value);
                        const existingSettlement = settlements.find(item => item.previousMonthKey === previousMonthKey) || null;
                        const existingTransaction = existingSettlement
                            ? vault.transactions.find(item => item.id === existingSettlement.vaultTransactionId) || null
                            : null;
                        if (existingSettlement) {
                            result = { vault, settlements, settlement: existingSettlement, transaction: existingTransaction, alreadySettled: true };
                            return;
                        }

                        const existingTransfer = vault.transactions.find(item => item.type === 'surplus_transfer' && item.sourceMonthKey === previousMonthKey) || null;
                        const effectiveDecision = existingTransfer ? 'vault' : decision;
                        const transaction = effectiveDecision === 'vault'
                            ? existingTransfer || normalizeVaultTransactionRecord({
                                id: `vault-settlement-${previousMonthKey}`,
                                amount: surplus,
                                date: referenceDate,
                                monthKey: targetMonthKey,
                                sourceMonthKey: previousMonthKey,
                                createdAt: new Date().toISOString()
                            })
                            : null;
                        const settlement = normalizeMonthEndSettlementRecord({
                            previousMonthKey,
                            decision: effectiveDecision,
                            targetMonthKey: effectiveDecision === 'budget' ? targetMonthKey : '',
                            surplus: effectiveDecision === 'no_surplus' ? 0 : (existingTransfer?.amount ?? surplus),
                            previousMonthBudget,
                            previousMonthSpent,
                            settledAt: new Date().toISOString(),
                            vaultTransactionId: transaction?.id || ''
                        });
                        if (!settlement || (effectiveDecision === 'vault' && !transaction)) {
                            tx.abort();
                            return;
                        }

                        const nextVault = transaction && !existingTransfer
                            ? normalizeVaultStateRecord({ ...vault, transactions: [transaction, ...vault.transactions.filter(item => item.id !== transaction.id)] })
                            : vault;
                        const nextSettlements = normalizeMonthEndSettlements([...settlements, settlement]);
                        if (transaction && !existingTransfer) settings.put({ key: 'vault', value: toSerializableValue(nextVault) });
                        settings.put({ key: 'monthEndSettlements', value: toSerializableValue(nextSettlements) });
                        result = { vault: nextVault, settlements: nextSettlements, settlement, transaction };
                    };

                    vaultRequest.onsuccess = () => {
                        vaultValue = vaultRequest.result;
                        hasVaultValue = true;
                        writeResolution();
                    };
                    settlementsRequest.onsuccess = () => {
                        settlementsValue = settlementsRequest.result;
                        hasSettlementsValue = true;
                        writeResolution();
                    };
                    tx.oncomplete = () => resolve(result);
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error || new DOMException('IndexedDB transaction aborted', 'AbortError'));
                }));
                this._settlementWriteQueue = operation.catch(() => {});
                return operation;
            },

            // --- NUKE OPTION ---
            // A blocked delete remains pending and resolves only after the
            // database is actually gone. This prevents a false "unchanged"
            // message followed by a later deletion from the same request.
            async factoryReset(onBlocked = null) {
                return new Promise((resolve, reject) => {
                    if (this.db) this.db.close();
                    this.db = null; // Prevent stale connection usage
                    const req = indexedDB.deleteDatabase(this.dbName);
                    req.onsuccess = () => {
                        resolve();
                    };
                    req.onerror = () => reject(req.error || new Error('IndexedDB deleteDatabase failed'));
                    req.onblocked = () => {
                        if (typeof onBlocked === 'function') onBlocked();
                    };
                });
            }
        };

        /**
         * ================================================================
         * MODULE: STORE (Reactive State Manager)
         * ================================================================
         * The brain of the application. It connects Vue to the Database.
         * Handles the "Variance Engine" logic and centralized data fetching.
         */
        const { reactive, computed, watchEffect } = Vue;

        const Store = reactive({
            // --- STATE ---
            isReady: false,
            _loadGen: 0, // Generation counter for race-safe loadDay
            _autoFillLock: false, // Prevent double auto-fill invocations
            _flexibleStatsGen: 0,
            _statisticsGen: 0,
            currentDate: Core.Date.getTodayISO(),
            settings: {
                baseAllowance: 1000,
                rent: 350,
                targetSavings: 0,
                safeToSpendMode: 'monthly',  // V5: 'weekly' or 'monthly'
                motionLevel: normalizeMotionLevel(localStorage.getItem('rushd_motion')),
                theme: localStorage.getItem('rushd_theme') === 'light' ? 'light' : 'dark',
                templateProfiles: [LEGACY_TEMPLATE_PROFILE],
                activeTemplateProfileId: LEGACY_TEMPLATE_PROFILE.id,
                monthlyTemplateAssignments: [],
                // P1-03: monthKey -> base allowance recorded while that month was
                // live, so older periods keep the budget they actually had.
                monthlyBaseAllowances: {},
                vault: { balance: 0, transactions: [], goals: [] },
                monthEndSettlements: []
            },
            templates: [],

            // We cache expenses for the current VIEW only (performance optimization)
            // But we keep global totals for the dashboard
            currentViewExpenses: [],
            globalStats: {
                totalSaved: 0,
                totalOverspent: 0,
                netVariance: 0,
                monthlyPaid: 0,      // V4: Paid costs this month
                monthlyExpected: 0,   // V4: Expected costs this month (unpaid)
                monthlySpent: 0       // V4: Total = monthlyPaid + monthlyExpected
            },
            flexibleStats: {
                monthKey: '',
                items: [],
                totalBudget: 0,
                totalUsedBudget: 0,
                totalRemainingBudget: 0,
                totalRemainingUses: 0
            },
            statistics: {
                monthKey: '',
                budgetKnown: true,
                budget: 0,
                paidSpent: 0,
                unpaidEssential: 0,
                safeToSpend: 0,
                projectedBalance: 0,
                essentialSpent: 0,
                luxurySpent: 0,
                luxuryCount: 0,
                previousMonthKey: '',
                previousMonthSpent: 0,
                previousMonthLuxurySpent: 0,
                spentDelta: 0,
                luxuryDelta: 0,
                categoryBreakdown: [],
                weeklySpending: [],
                budgetUtilization: 0,
                essentialCount: 0
            },

            // --- ACTIONS ---

            async init() {
                await DB.connect();

                // Load Settings
                this.settings.baseAllowance = normalizePersistedMoney(await DB.getSetting('baseAllowance', 1000), 1000);
                await DB.setSetting('baseAllowance', this.settings.baseAllowance);
                // P1-05: the fake "divide by four" weekly view was removed. Any
                // stored weekly preference normalizes to the honest monthly view.
                this.settings.safeToSpendMode = 'monthly';
                if (await DB.getSetting('safeToSpendMode', 'monthly') !== 'monthly') {
                    await DB.setSetting('safeToSpendMode', 'monthly');
                }
                this.settings.motionLevel = normalizeMotionLevel(await DB.getSetting('motionLevel', localStorage.getItem('rushd_motion') || 'auto'));
                this.settings.theme = await DB.getSetting('theme', localStorage.getItem('rushd_theme') === 'light' ? 'light' : 'dark');
                this.settings.templateProfiles = normalizeTemplateProfiles(await DB.getSetting('templateProfiles', []));
                this.settings.activeTemplateProfileId = await DB.getSetting('activeTemplateProfileId', LEGACY_TEMPLATE_PROFILE.id);
                this.settings.monthlyTemplateAssignments = normalizeMonthlyTemplateAssignments(await DB.getSetting('monthlyTemplateAssignments', []));
                this.settings.monthlyBaseAllowances = normalizeMonthlyBaseAllowances(await DB.getSetting('monthlyBaseAllowances', {}));
                this.settings.vault = normalizeVaultStateRecord(await DB.getSetting('vault', null));
                await DB.setSetting('vault', this.settings.vault);
                this.settings.monthEndSettlements = normalizeMonthEndSettlements(await DB.getSetting('monthEndSettlements', []));
                // P1-03: record this month's allowance so later changes cannot
                // rewrite what this month's budget claim will be.
                await this.recordCurrentMonthBaseAllowance();

                // Load Templates
                this.templates = await DB.getTemplates();

                // One-time cleanup: remove old seed templates that may conflict with user templates
                const seedIds = ['t1', 't2', 't3', 't4', 't5', 't6'];
                const hasSeedData = this.templates.some(t => seedIds.includes(t.id));
                if (hasSeedData) {
                    for (const id of seedIds) {
                        try { await DB.deleteTemplate(id); } catch (e) { }
                    }
                    this.templates = await DB.getTemplates(); // Reload without seeds
                }

                await this.ensureTemplateProfilesState();

                // Calculate Global Variance (Heavy calculation, done once on load)
                await this.recalcGlobalStats();

                // Load today's view
                await this.loadDay(this.currentDate);

                this.isReady = true;
            console.log("Rushd initialized");
            },

            async ensureTemplateProfilesState() {
                const normalizedProfiles = normalizeTemplateProfiles(this.settings.templateProfiles);
                let profilesChanged = JSON.stringify(normalizedProfiles) !== JSON.stringify(this.settings.templateProfiles);
                const normalizedAssignments = normalizeMonthlyTemplateAssignments(this.settings.monthlyTemplateAssignments);
                let assignmentsChanged = JSON.stringify(normalizedAssignments) !== JSON.stringify(this.settings.monthlyTemplateAssignments);
                const knownProfileIds = new Set(normalizedProfiles.map(profile => profile.id));
                const normalizedTemplates = [];
                const templatesToPersist = [];

                for (const template of this.templates) {
                    const normalizedTemplate = normalizeDefinitionRecord(template);
                    normalizedTemplates.push(normalizedTemplate);

                    if (template?.profileId !== normalizedTemplate.profileId) {
                        templatesToPersist.push(normalizedTemplate);
                    }

                    if (!knownProfileIds.has(normalizedTemplate.profileId)) {
                        knownProfileIds.add(normalizedTemplate.profileId);
                        normalizedProfiles.push({ id: normalizedTemplate.profileId, name: normalizedTemplate.profileId });
                        profilesChanged = true;
                    }
                }

                for (const assignment of normalizedAssignments) {
                    if (!knownProfileIds.has(assignment.assignedProfileId)) {
                        knownProfileIds.add(assignment.assignedProfileId);
                        normalizedProfiles.push({ id: assignment.assignedProfileId, name: assignment.assignedProfileId });
                        profilesChanged = true;
                    }
                }

                this.templates = normalizedTemplates;

                for (const template of templatesToPersist) {
                    await DB.saveTemplate(template);
                }

                this.settings.templateProfiles = normalizeTemplateProfiles(normalizedProfiles);
                this.settings.monthlyTemplateAssignments = normalizedAssignments;

                if (!this.settings.templateProfiles.some(profile => profile.id === this.settings.activeTemplateProfileId)) {
                    this.settings.activeTemplateProfileId = this.settings.templateProfiles[0]?.id || LEGACY_TEMPLATE_PROFILE.id;
                    profilesChanged = true;
                }

                if (profilesChanged || assignmentsChanged) {
                    if (assignmentsChanged) {
                        await DB.setSetting('monthlyTemplateAssignments', this.settings.monthlyTemplateAssignments);
                    }
                    await DB.setSetting('templateProfiles', this.settings.templateProfiles);
                    await DB.setSetting('activeTemplateProfileId', this.settings.activeTemplateProfileId);
                }
            },

            getMonthlyTemplateAssignment(dateStr = this.currentDate) {
                const monthKey = getMonthKey(dateStr || this.currentDate || Core.Date.getTodayISO());
                return this.settings.monthlyTemplateAssignments.find(assignment => assignment.monthKey === monthKey) || null;
            },

            resolveTemplateProfileIdForDate(dateStr, fallbackProfileId = this.settings.activeTemplateProfileId) {
                const assignment = this.getMonthlyTemplateAssignment(dateStr);
                // P1-07: an assignment governs only dates from its effective date
                // forward. Earlier dates must not silently inherit month-wide plan
                // behavior; per-date revision history belongs to the P03/P04
                // versioned plan domain.
                if (assignment && dateStr && dateStr >= assignment.effectiveDate) {
                    const assignedProfileId = getDefinitionProfileId({ profileId: assignment.assignedProfileId }, '');
                    if (assignedProfileId) return assignedProfileId;
                }
                return getDefinitionProfileId({ profileId: fallbackProfileId });
            },

            getTemplateProfileRecord(profileId = this.settings.activeTemplateProfileId) {
                return getTemplateProfileRecordById(this.settings.templateProfiles, profileId);
            },

            async upsertMonthlyTemplateAssignment(dateStr, profileId = this.settings.activeTemplateProfileId) {
                const normalizedAssignment = normalizeMonthlyTemplateAssignmentRecord({
                    monthKey: getMonthKey(dateStr),
                    assignedProfileId: profileId,
                    effectiveDate: dateStr
                });
                if (!normalizedAssignment) return null;

                this.settings.monthlyTemplateAssignments = normalizeMonthlyTemplateAssignments([
                    ...this.settings.monthlyTemplateAssignments.filter(assignment => assignment.monthKey !== normalizedAssignment.monthKey),
                    normalizedAssignment
                ]);
                await DB.setSetting('monthlyTemplateAssignments', this.settings.monthlyTemplateAssignments);
                return normalizedAssignment;
            },

            getMonthEndSettlement(monthKey) {
                if (!MONTH_KEY_PATTERN.test(monthKey || '')) return null;
                return this.settings.monthEndSettlements.find(settlement => settlement.previousMonthKey === monthKey) || null;
            },

            getBudgetCarryoverForMonth(monthKey) {
                if (!MONTH_KEY_PATTERN.test(monthKey || '')) return 0;
                return this.settings.monthEndSettlements.reduce((sum, settlement) => {
                    if (settlement.decision !== 'budget' || settlement.targetMonthKey !== monthKey) return sum;
                    return sum + Math.max(0, toFiniteNumber(settlement.surplus, 0));
                }, 0);
            },

            getBudgetForMonth(monthKey) {
                const currentMonthKey = getMonthKey(Core.Date.getTodayISO());
                // P1-03: a past month keeps the allowance recorded while that month
                // was live. Changing today's allowance must not rewrite the budget
                // Rushd claims for an older period.
                if (currentMonthKey && monthKey && monthKey < currentMonthKey) {
                    const history = isPlainObjectRecord(this.settings.monthlyBaseAllowances)
                        ? this.settings.monthlyBaseAllowances
                        : {};
                    const recorded = toFiniteNumber(history[monthKey], NaN);
                    // Review fix: without a trustworthy record the historical budget
                    // is unknown. Today's allowance must never become historical
                    // fact, so callers receive null and surface that state.
                    if (!Number.isFinite(recorded)) return null;
                    return recorded + this.getBudgetCarryoverForMonth(monthKey);
                }
                return toFiniteNumber(this.settings.baseAllowance, 1000) + this.getBudgetCarryoverForMonth(monthKey);
            },

            async recordCurrentMonthBaseAllowance() {
                const monthKey = getMonthKey(Core.Date.getTodayISO());
                if (!MONTH_KEY_PATTERN.test(monthKey || '')) return this.settings.monthlyBaseAllowances;
                const value = toFiniteNumber(this.settings.baseAllowance, 1000);
                const history = isPlainObjectRecord(this.settings.monthlyBaseAllowances)
                    ? { ...this.settings.monthlyBaseAllowances }
                    : {};
                if (toFiniteNumber(history[monthKey], NaN) === value) return history;
                history[monthKey] = value;
                this.settings.monthlyBaseAllowances = history;
                await DB.setSetting('monthlyBaseAllowances', history);
                return history;
            },

            async persistVaultState() {
                this.settings.vault = normalizeVaultStateRecord(this.settings.vault);
                await DB.setSetting('vault', this.settings.vault);
                return this.settings.vault;
            },

            async addVaultGoal(goal) {
                const normalizedGoal = normalizeVaultGoalRecord(goal);
                if (!normalizedGoal) return null;
                this.settings.vault = normalizeVaultStateRecord({
                    ...this.settings.vault,
                    goals: [...(this.settings.vault.goals || []), normalizedGoal]
                });
                await this.persistVaultState();
                return normalizedGoal;
            },

            async deleteVaultGoal(goalId) {
                const normalizedGoalId = typeof goalId === 'string' ? goalId : '';
                if (!normalizedGoalId) return false;
                const currentGoals = Array.isArray(this.settings.vault.goals) ? this.settings.vault.goals : [];
                const nextGoals = currentGoals.filter(goal => goal.id !== normalizedGoalId);
                if (nextGoals.length === currentGoals.length) return false;
                this.settings.vault = normalizeVaultStateRecord({
                    ...this.settings.vault,
                    goals: nextGoals
                });
                await this.persistVaultState();
                return true;
            },

            async persistMonthEndSettlements() {
                this.settings.monthEndSettlements = normalizeMonthEndSettlements(this.settings.monthEndSettlements);
                await DB.setSetting('monthEndSettlements', this.settings.monthEndSettlements);
                return this.settings.monthEndSettlements;
            },

            async addVaultTransaction(transaction) {
                const normalizedTransaction = normalizeVaultTransactionRecord(transaction);
                if (!normalizedTransaction) return null;
                this.settings.vault = normalizeVaultStateRecord({
                    ...this.settings.vault,
                    transactions: [normalizedTransaction, ...(this.settings.vault.transactions || [])]
                });
                await this.persistVaultState();
                return normalizedTransaction;
            },

            async getMonthFinancialSnapshot(monthKey) {
                if (!MONTH_KEY_PATTERN.test(monthKey || '')) return null;
                const { monthStart, monthEnd } = getMonthBoundsFromDate(`${monthKey}-01`);
                if (!monthStart || !monthEnd) return null;
                const allExpenses = await DB.getAllExpenses();
                let actualSpent = 0;
                let unpaidReserved = 0;

                allExpenses.forEach(expense => {
                    if (expense.date < monthStart || expense.date > monthEnd) return;
                    if (expense.isPaid) {
                        actualSpent += expense.actualPaid;
                    } else if ((expense.classification || 'essential') === 'essential') {
                        unpaidReserved += expense.expectedCost;
                    }
                });

                const budget = this.getBudgetForMonth(monthKey);
                const budgetKnown = budget !== null;
                return {
                    monthKey,
                    monthStart,
                    monthEnd,
                    budgetKnown,
                    budget,
                    spent: actualSpent,
                    unpaidReserved,
                    surplus: budgetKnown ? Math.max(0, budget - actualSpent - unpaidReserved) : null
                };
            },

            async settleMonthEnd(decision, summary, referenceDate = Core.Date.getTodayISO()) {
                const previousMonthKey = typeof summary?.previousMonthKey === 'string' ? summary.previousMonthKey : '';
                const targetMonthKey = getMonthKey(referenceDate);
                const surplus = Math.max(0, normalizePersistedMoney(summary?.surplus, 0));
                if (!MONTH_END_SETTLEMENT_DECISIONS.includes(decision)
                    || !MONTH_KEY_PATTERN.test(previousMonthKey)
                    || (decision !== 'no_surplus' && (!targetMonthKey || surplus <= 0))) return null;
                const resolved = await DB.resolveMonthEndSettlement({
                    previousMonthKey,
                    decision,
                    targetMonthKey,
                    surplus,
                    previousMonthBudget: normalizePersistedMoney(summary?.previousMonthBudget, 0),
                    previousMonthSpent: normalizePersistedMoney(summary?.previousMonthSpent, 0),
                    referenceDate
                });
                if (!resolved) return null;
                this.settings.vault = resolved.vault;
                this.settings.monthEndSettlements = resolved.settlements;
                return resolved;
            },

            async settleMonthEndToVault(summary, referenceDate = Core.Date.getTodayISO()) {
                return this.settleMonthEnd('vault', summary, referenceDate);
            },

            async settleMonthEndToBudget(summary, referenceDate = Core.Date.getTodayISO()) {
                return this.settleMonthEnd('budget', summary, referenceDate);
            },

            async settleMonthEndNoSurplus(summary, referenceDate = Core.Date.getTodayISO()) {
                return this.settleMonthEnd('no_surplus', summary, referenceDate);
            },

            async loadDay(dateStr) {
                const gen = ++this._loadGen;
                this.currentDate = dateStr;
                this.currentViewExpenses = []; // Clear immediately to avoid stale data
                const expenses = await DB.getExpensesByDate(dateStr);
                // P1-08: one generation guards the complete day-loading and
                // derived-statistics pipeline. A late response for date A must
                // never publish or refresh over the newer date B.
                if (gen !== this._loadGen) return;
                this.currentViewExpenses = expenses;
                await this.refreshFlexibleStats(dateStr, gen);
                if (gen !== this._loadGen) return;
                await this.refreshStatistics(dateStr, gen);
            },

            // P1-08: when a refresh runs inside the loadDay pipeline, its publishes
            // must be dropped if a newer loadDay took over while they were awaited.
            _pipelineGenIsCurrent(pipelineGen) {
                return pipelineGen === null || pipelineGen === this._loadGen;
            },

            async refreshFlexibleStats(referenceDate = this.currentDate, pipelineGen = null) {
                const targetDate = referenceDate || this.currentDate || Core.Date.getTodayISO();
                const monthKey = getMonthKey(targetDate);
                const gen = ++this._flexibleStatsGen;
                const activeTemplateProfileId = getDefinitionProfileId({ profileId: this.settings.activeTemplateProfileId });
                const definitions = this.templates
                    .filter(template => isFlexibleDefinitionRecord(template) && isDefinitionInProfile(template, activeTemplateProfileId))
                    .map(normalizeDefinitionRecord);

                if (definitions.length === 0) {
                    if (gen === this._flexibleStatsGen && this._pipelineGenIsCurrent(pipelineGen)) {
                        this.flexibleStats = {
                            monthKey,
                            items: [],
                            totalBudget: 0,
                            totalUsedBudget: 0,
                            totalRemainingBudget: 0,
                            totalRemainingUses: 0
                        };
                    }
                    return;
                }

                const definitionIdsByName = new Map(definitions.map(definition => [definition.name, definition.id]));
                const usageByDefinitionId = new Map();
                const allExpenses = await DB.getAllExpenses();

                allExpenses.forEach(expense => {
                    if (expense.source !== 'flexible' || getMonthKey(expense.date) !== monthKey) return;

                    const definitionId = expense.flexibleDefinitionId || definitionIdsByName.get(expense.name);
                    if (!definitionId) return;

                    const usage = usageByDefinitionId.get(definitionId) || { usedBudget: 0, uses: 0 };
                    usage.usedBudget += toFiniteNumber(expense.expectedCost, 0);
                    usage.uses += 1;
                    usageByDefinitionId.set(definitionId, usage);
                });

                const items = definitions.map(definition => {
                    const usage = usageByDefinitionId.get(definition.id) || { usedBudget: 0, uses: 0 };
                    const remainingBudget = Math.max(0, definition.monthlyBudget - usage.usedBudget);
                    const remainingUses = Math.max(0, definition.maxUsesPerMonth - usage.uses);

                    return {
                        ...definition,
                        usedBudget: usage.usedBudget,
                        uses: usage.uses,
                        remainingBudget,
                        remainingUses
                    };
                });

                if (gen !== this._flexibleStatsGen || !this._pipelineGenIsCurrent(pipelineGen)) return;

                this.flexibleStats = {
                    monthKey,
                    items,
                    totalBudget: items.reduce((sum, item) => sum + item.monthlyBudget, 0),
                    totalUsedBudget: items.reduce((sum, item) => sum + item.usedBudget, 0),
                    totalRemainingBudget: items.reduce((sum, item) => sum + item.remainingBudget, 0),
                    totalRemainingUses: items.reduce((sum, item) => sum + item.remainingUses, 0)
                };
            },

            async refreshStatistics(referenceDate = this.currentDate, pipelineGen = null) {
                const targetDate = referenceDate || this.currentDate || Core.Date.getTodayISO();
                const { monthKey, monthStart, monthEnd } = getMonthBoundsFromDate(targetDate);
                const previousMonthKey = getPreviousMonthKey(targetDate);
                const previousMonthBounds = previousMonthKey ? getMonthBoundsFromDate(`${previousMonthKey}-01`) : { monthStart: '', monthEnd: '' };
                const gen = ++this._statisticsGen;

                const emptyStats = {
                    monthKey: '', budgetKnown: true, budget: 0, paidSpent: 0, unpaidEssential: 0,
                    safeToSpend: 0, projectedBalance: 0, essentialSpent: 0,
                    luxurySpent: 0, luxuryCount: 0, essentialCount: 0,
                    previousMonthKey: '', previousMonthSpent: 0, previousMonthLuxurySpent: 0,
                    spentDelta: 0, luxuryDelta: 0,
                    categoryBreakdown: [], weeklySpending: [], budgetUtilization: 0
                };

                if (!monthKey || !monthStart || !monthEnd) {
                    if (gen === this._statisticsGen && this._pipelineGenIsCurrent(pipelineGen)) this.statistics = emptyStats;
                    return;
                }

                const allExpenses = (await DB.getAllExpenses()).map(normalizeExpenseRecord);
                let paidSpent = 0;
                let unpaidEssential = 0;
                let essentialSpent = 0;
                let luxurySpent = 0;
                let luxuryCount = 0;
                let essentialCount = 0;
                let previousMonthSpent = 0;
                let previousMonthLuxurySpent = 0;
                const categoryMap = {};
                const weeklyMap = {};

                // Determine week boundaries for current month
                const monthStartDate = new Date(monthStart + 'T00:00:00');
                const monthEndDate = new Date(monthEnd + 'T00:00:00');

                allExpenses.forEach(expense => {
                    const classification = expense.classification || 'essential';
                    const actualPaid = toFiniteNumber(expense.actualPaid, 0);
                    const expectedCost = toFiniteNumber(expense.expectedCost, 0);
                    const inCurrentMonth = expense.date >= monthStart && expense.date <= monthEnd;
                    const inPreviousMonth = previousMonthBounds.monthStart
                        && previousMonthBounds.monthEnd
                        && expense.date >= previousMonthBounds.monthStart
                        && expense.date <= previousMonthBounds.monthEnd;

                    if (inCurrentMonth) {
                        if (classification === 'luxury') {
                            luxuryCount += 1;
                        } else {
                            essentialCount += 1;
                        }

                        if (expense.isPaid) {
                            paidSpent += actualPaid;
                            if (classification === 'luxury') {
                                luxurySpent += actualPaid;
                            } else {
                                essentialSpent += actualPaid;
                            }

                            // Category breakdown (paid only)
                            const cat = expense.category || 'other';
                            if (!categoryMap[cat]) categoryMap[cat] = { category: cat, amount: 0, count: 0 };
                            categoryMap[cat].amount += actualPaid;
                            categoryMap[cat].count += 1;

                            // Weekly spending (paid only)
                            const expDate = new Date(expense.date + 'T00:00:00');
                            const dayOfMonth = expDate.getDate();
                            const weekIndex = Math.min(3, Math.floor((dayOfMonth - 1) / 7));
                            if (!weeklyMap[weekIndex]) weeklyMap[weekIndex] = 0;
                            weeklyMap[weekIndex] += actualPaid;
                        } else if (classification === 'essential') {
                            unpaidEssential += expectedCost;
                        }
                    }

                    if (inPreviousMonth && expense.isPaid) {
                        previousMonthSpent += actualPaid;
                        if (classification === 'luxury') {
                            previousMonthLuxurySpent += actualPaid;
                        }
                    }
                });

                if (gen !== this._statisticsGen || !this._pipelineGenIsCurrent(pipelineGen)) return;

                // P1-03 review fix: an unsnapshotted historical month has no
                // trustworthy budget. Publish the unavailable state instead of a
                // number derived from today's allowance.
                const budget = this.getBudgetForMonth(monthKey);
                const budgetKnown = budget !== null;
                const safeToSpend = budgetKnown ? budget - paidSpent - unpaidEssential : null;

                // Build sorted category breakdown
                const categoryBreakdown = Object.values(categoryMap)
                    .sort((a, b) => b.amount - a.amount)
                    .map(cat => ({
                        ...cat,
                        percentage: paidSpent > 0 ? (cat.amount / paidSpent) * 100 : 0
                    }));

                // Build weekly spending array (4 weeks)
                const weeklySpending = [0, 1, 2, 3].map(i => ({
                    week: i + 1,
                    amount: weeklyMap[i] || 0
                }));

                this.statistics = {
                    monthKey,
                    budgetKnown,
                    budget,
                    paidSpent,
                    unpaidEssential,
                    safeToSpend,
                    projectedBalance: safeToSpend,
                    essentialSpent,
                    luxurySpent,
                    luxuryCount,
                    essentialCount,
                    previousMonthKey,
                    previousMonthSpent,
                    previousMonthLuxurySpent,
                    spentDelta: paidSpent - previousMonthSpent,
                    luxuryDelta: luxurySpent - previousMonthLuxurySpent,
                    categoryBreakdown,
                    weeklySpending,
                    budgetUtilization: budgetKnown && budget > 0 ? Math.min(100, (paidSpent / budget) * 100) : 0
                };
            },

            // The "Variance Engine" Logic
            async recalcGlobalStats() {
                const all = await DB.getAllExpenses();
                let saved = 0;
                let over = 0;
                let monthlyPaid = 0;
                let monthlyExpected = 0;

                // Get current month bounds
                const { monthStart, monthEnd } = getMonthBoundsFromDate();

                all.forEach(e => {
                    // Calculate variance for all paid expenses
                    if (e.isPaid) {
                        const variance = e.expectedCost - e.actualPaid;
                        if (variance > 0) saved += variance;
                        else over += Math.abs(variance);
                    }

                    // V4: Calculate monthly costs (paid + expected)
                    // Luxury unpaid expenses do NOT count toward expected commitments
                    if (e.date >= monthStart && e.date <= monthEnd) {
                        if (e.isPaid) {
                            monthlyPaid += e.actualPaid;
                        } else {
                            const cls = e.classification || 'essential';
                            if (cls === 'essential') {
                                monthlyExpected += e.expectedCost;
                            }
                        }
                    }
                });

                this.globalStats.totalSaved = saved;
                this.globalStats.totalOverspent = over;
                this.globalStats.netVariance = saved - over;
                this.globalStats.monthlyPaid = monthlyPaid;
                this.globalStats.monthlyExpected = monthlyExpected;
                this.globalStats.monthlySpent = monthlyPaid + monthlyExpected;
            },

            // --- MUTATIONS (Data Writers) ---

            async addExpense(expense) {
                // Ensure ID
                if (!expense.id) expense.id = Core.UUID();
                expense = normalizeExpenseRecord({ ...expense, source: expense.source ?? 'manual' });

                // Optimistic UI Update (Instant feedback before DB confirms)
                if (expense.date === this.currentDate) {
                    this.currentViewExpenses.push(expense);
                }

                await DB.saveExpense(expense);
                await this.recalcGlobalStats(); // Update the "Safe to Spend" number
                await this.refreshFlexibleStats(this.currentDate);
                await this.refreshStatistics(this.currentDate);
            },

            async updateExpense(updatedExpense) {
                updatedExpense = normalizeExpenseRecord(updatedExpense);
                // Optimistic UI
                const idx = this.currentViewExpenses.findIndex(e => e.id === updatedExpense.id);
                if (idx !== -1) {
                    this.currentViewExpenses[idx] = updatedExpense;
                }

                await DB.saveExpense(updatedExpense);
                await this.recalcGlobalStats();
                await this.refreshFlexibleStats(this.currentDate);
                await this.refreshStatistics(this.currentDate);
            },

            async deleteExpense(id) {
                this.currentViewExpenses = this.currentViewExpenses.filter(e => e.id !== id);
                await DB.deleteExpense(id);
                await this.recalcGlobalStats();
                await this.refreshFlexibleStats(this.currentDate);
                await this.refreshStatistics(this.currentDate);
            },

            // Template Logic
            async seedTemplates() {
                const seeds = [
                    { id: 't1', name: 'Taxi to College', expectedCost: 8, category: 'transport', recurrence: 'daily' },
                    { id: 't2', name: 'Taxi Home', expectedCost: 8, category: 'transport', recurrence: 'daily' },
                    { id: 't3', name: 'Water Gallon', expectedCost: 8, category: 'food', recurrence: 'daily' },
                    { id: 't4', name: 'Bus Trip', expectedCost: 19, category: 'transport', recurrence: 'monthly', days: [31, 7, 14, 22] }, // Using numeric dates roughly
                    { id: 't5', name: 'Tabby Payment', expectedCost: 120, category: 'other', recurrence: 'monthly', days: [1] },
                    { id: 't6', name: 'Internet', expectedCost: 60, category: 'utilities', recurrence: 'monthly', days: [1] }
                ];

                for (const t of seeds) {
                    await DB.saveTemplate(t);
                }
                this.templates = seeds;
            },

            // P1-06 review fix: monthly templates whose stored record carries no
            // valid schedule day (legacy rows can predate the day requirement).
            // They stay stored untouched — Rushd never invents a day — but every
            // generation path blocks visibly until one is chosen.
            getInvalidMonthlyScheduleTemplates(profileId = null) {
                return this.templates.filter(template => {
                    if (isFlexibleDefinitionRecord(template)) return false;
                    const normalizedTemplate = normalizeDefinitionRecord(template);
                    if (normalizedTemplate.recurrence !== 'monthly') return false;
                    if (profileId && !isDefinitionInProfile(template, profileId)) return false;
                    return !hasValidMonthlySchedule(normalizedTemplate);
                });
            },

            // The "Auto-Fill" Logic
            async autoFillDay(dateStr) {
                // Prevent double invocation
                if (this._autoFillLock) return 0;
                // P1-07 review fix: Auto-Fill on a historical date would regenerate
                // activity from today's mutable profile and template rules. The
                // original revision is unknown, so past dates are refused here and
                // visibly blocked with an explanation at the UI layer.
                if (dateStr && dateStr < Core.Date.getTodayISO()) return 0;
                this._autoFillLock = true;
                try {
                    // FORCE SYNC: Ensure we have the absolute latest templates from DB
                this.templates = await DB.getTemplates();
                const activeTemplateProfileId = this.resolveTemplateProfileIdForDate(dateStr);
                const activeTemplateProfile = this.getTemplateProfileRecord(activeTemplateProfileId);

                // P1-06 review fix: a legacy monthly template without a schedule day
                // would silently generate nothing. Auto-Fill refuses to run until the
                // day is repaired, and the UI layer shows the bilingual explanation.
                if (this.getInvalidMonthlyScheduleTemplates(activeTemplateProfileId).length > 0) return 0;

                    const existing = await DB.getExpensesByDate(dateStr);
                    const existingNames = new Set(existing.map(e => e.name));

                    const toAdd = [];

                    this.templates.forEach(t => {
                        if (isFlexibleDefinitionRecord(t)) return;
                        if (!isDefinitionInProfile(t, activeTemplateProfileId)) return;
                        if (existingNames.has(t.name)) return;
                        // Only add daily templates via auto-fill
                        if (t.recurrence !== 'daily') return;
                        if (!templateOccursOnDate(t, dateStr, activeTemplateProfile)) return;

                        toAdd.push({
                            id: Core.UUID(),
                            name: t.name,
                            expectedCost: t.expectedCost,
                            actualPaid: 0,
                            isPaid: false,
                            category: t.category,
                            classification: t.classification || 'essential',
                            source: 'template',
                            templateOriginId: t.id,
                            date: dateStr,
                            timestamp: Date.now()
                        });
                    });

                    if (toAdd.length > 0) {
                        for (const expense of toAdd) {
                            await DB.saveExpense(expense);
                        }
                        // Refresh view from DB to avoid duplicates
                        if (dateStr === this.currentDate) {
                            this.currentViewExpenses = await DB.getExpensesByDate(dateStr);
                        }
                        await this.recalcGlobalStats();
                        await this.refreshStatistics(dateStr);
                    }
                    return toAdd.length;
                } finally {
                    this._autoFillLock = false;
                }
            },

            async buildTemplateApplyPlan(effectiveDate, options = {}) {
                const normalizedEffectiveDate = typeof effectiveDate === 'string' && effectiveDate
                    ? effectiveDate
                    : (this.currentDate || Core.Date.getTodayISO());
                const { monthStart, monthEnd } = getMonthBoundsFromDate(normalizedEffectiveDate);

                if (!monthStart || !monthEnd) {
                    return {
                        rangeStart: normalizedEffectiveDate || '',
                        rangeEnd: normalizedEffectiveDate || '',
                        toCreate: [],
                        toUpdate: [],
                        toDelete: [],
                        summary: {
                            rangeStart: normalizedEffectiveDate || '',
                            rangeEnd: normalizedEffectiveDate || '',
                            createCount: 0,
                            updateCount: 0,
                            deleteCount: 0,
                            totalChanges: 0
                        }
                    };
                }

                const rangeStart = normalizedEffectiveDate >= monthStart ? normalizedEffectiveDate : monthStart;
                this.templates = await DB.getTemplates();
                const activeTemplateProfileId = options && options.profileId
                    ? getDefinitionProfileId({ profileId: options.profileId })
                    : this.resolveTemplateProfileIdForDate(normalizedEffectiveDate);
                const activeTemplateProfile = this.getTemplateProfileRecord(activeTemplateProfileId);

                const templates = this.templates.filter(template => !isFlexibleDefinitionRecord(template) && isDefinitionInProfile(template, activeTemplateProfileId));

                // P1-06 review fix: a monthly template without a schedule day can
                // never produce an occurrence, so planning would silently no-op.
                // The plan is refused atomically — zero mutations, zero writes —
                // until the template is repaired with a valid day.
                const invalidMonthlyTemplates = templates.filter(template => template.recurrence === 'monthly' && !hasValidMonthlySchedule(template));
                if (invalidMonthlyTemplates.length > 0) {
                    const blockedSummary = {
                        rangeStart,
                        rangeEnd: monthEnd,
                        createCount: 0,
                        updateCount: 0,
                        deleteCount: 0,
                        totalChanges: 0,
                        blocked: true
                    };
                    return {
                        effectiveDate: normalizedEffectiveDate,
                        rangeStart,
                        rangeEnd: monthEnd,
                        toCreate: [],
                        toUpdate: [],
                        toDelete: [],
                        blocked: true,
                        blockedReason: 'monthlyDayMissing',
                        blockedTemplates: invalidMonthlyTemplates.map(template => ({ id: template.id, name: template.name || template.id })),
                        summary: blockedSummary
                    };
                }

                const allExpenses = (await DB.getAllExpenses()).map(normalizeExpenseRecord);
                const rangeExpenses = allExpenses.filter(expense => isDateInRange(expense.date, rangeStart, monthEnd));
                const expensesByDate = rangeExpenses.reduce((lookup, expense) => {
                    if (!lookup.has(expense.date)) lookup.set(expense.date, []);
                    lookup.get(expense.date).push(expense);
                    return lookup;
                }, new Map());
                // P0-01: generated activity that was already paid is a historical money
                // fact. Reconciliation must never rebuild, rewrite, or delete it.
                const mutableExpenseIds = new Set(rangeExpenses
                    .filter(expense => expense.source === 'template' && expense.templateProtected === false && !expense.isPaid)
                    .map(expense => expense.id));
                const usedExpenseIds = new Set();
                const toCreate = [];
                const toUpdate = [];

                for (const dateStr of enumerateDateRange(rangeStart, monthEnd)) {
                    const dateExpenses = expensesByDate.get(dateStr) || [];
                    for (const template of templates) {
                        if (!templateOccursOnDate(template, dateStr, activeTemplateProfile)) continue;

                        const mutableMatch = findTemplateExpenseMatch(
                            dateExpenses.filter(expense => mutableExpenseIds.has(expense.id)),
                            template,
                            dateStr,
                            usedExpenseIds
                        );

                        if (mutableMatch) {
                            usedExpenseIds.add(mutableMatch.id);
                            const rebuiltExpense = buildTemplateExpenseFromDefinition(template, dateStr, mutableMatch);
                            if (didTemplateExpenseRebuildChange(mutableMatch, rebuiltExpense)) {
                                toUpdate.push(rebuiltExpense);
                            }
                            continue;
                        }

                        const blockingMatch = findTemplateExpenseMatch(dateExpenses, template, dateStr, usedExpenseIds);
                        if (blockingMatch) continue;

                        toCreate.push(buildTemplateExpenseFromDefinition(template, dateStr));
                    }
                }

                const toDelete = rangeExpenses.filter(expense => mutableExpenseIds.has(expense.id) && !usedExpenseIds.has(expense.id));
                const summary = {
                    rangeStart,
                    rangeEnd: monthEnd,
                    createCount: toCreate.length,
                    updateCount: toUpdate.length,
                    deleteCount: toDelete.length
                };

                summary.totalChanges = summary.createCount + summary.updateCount + summary.deleteCount;

                return {
                    effectiveDate: normalizedEffectiveDate,
                    rangeStart,
                    rangeEnd: monthEnd,
                    toCreate,
                    toUpdate,
                    toDelete,
                    summary
                };
            },

            async applyTemplatesFrom(effectiveDate, options = {}) {
                const normalizedEffectiveDate = typeof effectiveDate === 'string' && effectiveDate
                    ? effectiveDate
                    : (this.currentDate || Core.Date.getTodayISO());
                const profileId = options && options.profileId
                    ? getDefinitionProfileId({ profileId: options.profileId }, this.settings.activeTemplateProfileId)
                    : getDefinitionProfileId({ profileId: this.settings.activeTemplateProfileId });
                const plan = await this.buildTemplateApplyPlan(normalizedEffectiveDate, { profileId });

                // P1-06 review fix: a blocked plan must not touch IndexedDB at all —
                // no expense writes and no monthly assignment write. The caller is
                // responsible for the visible bilingual explanation.
                if (plan.blocked) return plan;

                // P0-02: deletes, updates, creates, and the monthly assignment all
                // commit in one atomic IndexedDB transaction or not at all.
                const normalizedAssignment = normalizeMonthlyTemplateAssignmentRecord({
                    monthKey: getMonthKey(normalizedEffectiveDate),
                    assignedProfileId: profileId,
                    effectiveDate: normalizedEffectiveDate
                });
                const nextAssignments = normalizedAssignment
                    ? normalizeMonthlyTemplateAssignments([
                        ...this.settings.monthlyTemplateAssignments.filter(assignment => assignment.monthKey !== normalizedAssignment.monthKey),
                        normalizedAssignment
                    ])
                    : this.settings.monthlyTemplateAssignments;

                await DB.applyExpenseWritePlan({
                    deletes: plan.toDelete.map(expense => expense.id),
                    puts: [...plan.toUpdate, ...plan.toCreate],
                    settingsEntries: normalizedAssignment
                        ? [{ key: 'monthlyTemplateAssignments', value: nextAssignments }]
                        : []
                });

                this.settings.monthlyTemplateAssignments = nextAssignments;

                await this.recalcGlobalStats();

                if (isDateInRange(this.currentDate, plan.rangeStart, plan.rangeEnd)) {
                    this.currentViewExpenses = await DB.getExpensesByDate(this.currentDate);
                }

                await this.refreshStatistics(this.currentDate);

                return plan;
            },

            // --- GETTERS (Computed Properties) ---
            get safeToSpend() {
                // P1-03 review fix: an unsnapshotted historical month has no
                // trustworthy safe-to-spend amount; null means "unknown".
                if (this.statistics.budgetKnown === false) return null;
                return toFiniteNumber(this.statistics.safeToSpend, 0);
            },

            // V4: Add monthlySpent to globalStats
            get monthlySpent() {
                return this.globalStats.monthlyPaid + this.globalStats.monthlyExpected;
            }
        });


    return { Core, EXPENSE_SOURCE_VALUES, DEFINITION_SOURCE_VALUES, MOTION_LEVEL_VALUES, toFiniteNumber, MAX_MONEY_INPUT, MONEY_DECIMAL_PATTERN, parseMoneyInput, roundMoney, normalizePersistedMoney, normalizeMotionLevel, toNonNegativeInteger, getMonthKey, toISODate, parseLocalCalendarDate, DEFAULT_PROFILE_OFFDAYS, TEMPLATE_APPLICABILITY_VALUES, getMonthBoundsFromDate, getPreviousMonthKey, isDateInRange, enumerateDateRange, normalizeWeekdayIndex, normalizeProfileOffdays, normalizeTemplateDays, getValidTemplateDays, hasValidMonthlySchedule, getDateWeekdayIndex, isProfileOffdayForDate, templateMatchesApplicabilityForDate, getMonthlyTemplateDays, templateOccursOnDate, compareExpensePriority, matchesTemplateFallbackShape, findTemplateExpenseMatch, buildTemplateExpenseFromDefinition, didTemplateExpenseRebuildChange, LEGACY_TEMPLATE_PROFILE, MONTH_START_PROMPT_DEFER_KEY, MONTH_END_PROMPT_DEFER_KEY, ONBOARDING_STATE_KEY, ONBOARDING_STATUS_VALUES, MONTH_END_SETTLEMENT_DECISIONS, normalizeTemplateProfileRecord, normalizeTemplateProfiles, getTemplateProfileRecordById, MONTH_KEY_PATTERN, normalizeMonthlyTemplateAssignmentRecord, normalizeMonthlyTemplateAssignments, normalizeMonthlyBaseAllowances, normalizeOnboardingStateRecord, normalizeVaultGoalRecord, normalizeVaultGoals, normalizeVaultTransactionRecord, normalizeVaultStateRecord, normalizeMonthEndSettlementRecord, normalizeMonthEndSettlements, getDefinitionProfileId, isDefinitionInProfile, normalizeDefinitionRecord, isFlexibleDefinitionRecord, toSerializableValue, getExpenseTemplateOriginId, getExpenseTemplateProtection, didExpenseStructureChange, normalizeExpenseRecord, BACKUP_EXPENSE_MONEY_FIELDS, isPlainObjectRecord, isValidBackupMoneyValue, isValidIsoDateString, isValidTimestampString, hasDuplicateRecordIds, validateBackupPayload, DB, Store };
}
