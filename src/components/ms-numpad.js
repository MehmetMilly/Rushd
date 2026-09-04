// Mechanically extracted P02 runtime template. SFC conversion is deferred to P05/P06.
export function createMsNumpad(environment = globalThis) {
    const { navigator, performance, setTimeout, clearTimeout } = environment;
    return {
            emits: ['input', 'delete', 'confirm'],
            methods: {
                tap(key) {
                    if (navigator.vibrate) navigator.vibrate(5);
                    this.$emit('input', key);
                },
                del() {
                    if (navigator.vibrate) navigator.vibrate(10);
                    this.$emit('delete');
                },
                done() {
                    if (navigator.vibrate) navigator.vibrate(10);
                    this.$emit('confirm');
                }
            },
            template: `
                <div class="numpad-grid">
                    <button v-for="n in [1,2,3,4,5,6,7,8,9]" :key="n"
                            class="pad-key glass-panel" @click="tap(n)">{{ n }}</button>
                    <button class="pad-key glass-panel" @click="tap('.')">.</button>
                    <button class="pad-key glass-panel" @click="tap(0)">0</button>
                    <button class="pad-key glass-panel text-danger" @click="del()">
                        <ms-icon name="backspace"></ms-icon>
                    </button>
                </div>
            `
        };
}
