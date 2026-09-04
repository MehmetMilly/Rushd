// Mechanically extracted P02 runtime template. SFC conversion is deferred to P05/P06.
export function createMsButton(environment = globalThis) {
    const { navigator, performance, setTimeout, clearTimeout } = environment;
    return {
            props: {
                variant: { type: String, default: 'primary' }, // primary, danger, ghost, glass
                block: { type: Boolean, default: false },
                icon: { type: String, default: '' },
                loading: { type: Boolean, default: false }
            },
            methods: {
                trigger() {
                    if (this.loading) return;
                    // Haptic Feedback (if supported)
                    if (navigator.vibrate) navigator.vibrate(10);
                    this.$emit('click');
                }
            },
            template: `
                <button class="ms-btn"
                    :class="['variant-' + variant, { 'w-full': block, 'is-loading': loading }]"
                    @click="trigger">

                    <div v-if="loading" class="spinner"></div>

                    <div v-else class="content-wrapper">
                        <ms-icon v-if="icon" :name="icon" :size="20" style="margin-inline-end: 6px;"></ms-icon>
                        <slot></slot>
                    </div>
                </button>
            `,
            styles: `
                /* Injected Styles for Buttons (Conceptual) */
                /* See <style> block in Part 1 for reference classes */
            `
        };
}
