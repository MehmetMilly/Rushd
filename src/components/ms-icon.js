// Mechanically extracted P02 runtime template. SFC conversion is deferred to P05/P06.
export function createMsIcon(environment = globalThis) {
    const { navigator, performance, setTimeout, clearTimeout } = environment;
    return {
            props: ['name', 'size', 'fill'],
            computed: {
                iconStyle() {
                    return {
                        fontSize: (this.size || 24) + 'px',
                        fontVariationSettings: this.fill ? '"FILL" 1' : '"FILL" 0',
                        userSelect: 'none'
                    };
                }
            },
            template: `
                <span class="material-symbols-rounded" :style="iconStyle">
                    {{ name }}
                </span>
            `
        };
}
