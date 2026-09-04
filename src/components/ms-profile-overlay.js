// Mechanically extracted P02 runtime template. SFC conversion is deferred to P05/P06.
import { TRANSLATIONS } from '../app/i18n/translations.js';

export function createMsProfileOverlay(dataRuntime) {
    const { Store, toFiniteNumber } = dataRuntime;
    return {
            props: ['open', 'appLang'],
            emits: ['close'],
            setup() { return { store: Store } },
            computed: {
                t() {
                    return TRANSLATIONS[this.appLang] || TRANSLATIONS.ar;
                }
            },
            methods: {
                formatCompactAmount(value) {
                    const amount = toFiniteNumber(value, 0);
                    return Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2);
                }
            },
            template: `
                <ms-modal :modelValue="open" @update:modelValue="$emit('close')" :title="t.yourProfile">
                    <div class="flex flex-col gap-6">

                        <div class="glass-panel p-4 bg-surface-1 flex flex-col items-center gap-2 text-center">
                            <ms-icon name="emoji_events" size="24"></ms-icon>
                            <div class="text-sm font-bold">{{ t.momentumTitle }}</div>
                            <div class="text-xs text-secondary leading-relaxed">{{ t.momentumPlaceholder }}</div>
                        </div>

                        <div v-if="store.flexibleStats.items.length > 0">
                            <div class="text-xs font-bold text-secondary uppercase mb-3 ms-2">{{ t.flexibleConsumption }}</div>
                            <div class="glass-panel p-4 bg-surface-1 flex flex-col gap-3">
                                <div class="flex justify-between text-[10px] font-bold uppercase text-secondary">
                                    <span>{{ t.monthly }}</span>
                                    <span dir="ltr" style="unicode-bidi: isolate">{{ formatCompactAmount(store.flexibleStats.totalUsedBudget) }} / {{ formatCompactAmount(store.flexibleStats.totalBudget) }} SAR</span>
                                </div>
                                <div v-for="item in store.flexibleStats.items" :key="item.id" class="flex justify-between items-center gap-3 py-2 border-b border-glass last:border-b-0">
                                    <div class="min-w-0">
                                        <div class="font-semibold text-sm truncate">{{ item.name }}</div>
                                        <div class="text-[10px] text-secondary" dir="ltr" style="unicode-bidi: isolate">{{ formatCompactAmount(item.usedBudget) }} / {{ formatCompactAmount(item.monthlyBudget) }} SAR · {{ item.uses }} / {{ item.maxUsesPerMonth }}</div>
                                    </div>
                                    <div class="text-end shrink-0">
                                        <div class="text-xs font-mono" dir="ltr" style="unicode-bidi: isolate">{{ formatCompactAmount(item.remainingBudget) }} SAR</div>
                                        <div class="text-[10px] text-secondary">{{ t.remainingUses }}: {{ item.remainingUses }}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </ms-modal>
            `
        };
}
