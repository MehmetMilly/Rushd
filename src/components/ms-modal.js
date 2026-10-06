// Mechanically extracted P02 runtime template. SFC conversion is deferred to P05/P06.
export function createMsModal(environment = globalThis) {
    const { document } = environment;
    return {
            props: ['modelValue', 'title', 'closeLabel'], // v-model for open/close
            emits: ['update:modelValue'],
            computed: {
                closeAccessibleLabel() {
                    return this.closeLabel
                        || this.$root?.t?.cancel
                        || (document?.documentElement?.dir === 'rtl' ? 'إلغاء' : 'Cancel');
                }
            },
            template: `
                <transition name="fade">
                    <div v-if="modelValue" class="modal-backdrop" @click="$emit('update:modelValue', false)"></div>
                </transition>

                <transition name="modal-pop">
                    <div v-if="modelValue" class="modal-floating-card">
                        <!-- Red X Close Button -->
                        <button class="modal-close-btn" :aria-label="closeAccessibleLabel" @click="$emit('update:modelValue', false)">
                            <ms-icon name="close" size="14" aria-hidden="true"></ms-icon>
                        </button>

                        <div v-if="title" class="modal-header">
                            <h3>{{ title }}</h3>
                        </div>

                        <div class="modal-body no-scrollbar">
                            <slot></slot>
                        </div>
                    </div>
                </transition>
            `
        };
}
