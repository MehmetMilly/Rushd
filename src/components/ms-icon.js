// Mechanically extracted P02 runtime template. SFC conversion is deferred to P05/P06.
import iconManifest from './material-symbol-icons.json' with { type: 'json' };

const knownIcons = new Set(iconManifest.icons);

export function createMsIcon(environment = globalThis) {
    const { navigator, performance, setTimeout, clearTimeout } = environment;
    return {
            props: ['name', 'size'],
            computed: {
                iconName() {
                    return knownIcons.has(this.name) ? this.name : iconManifest.fallbackIcon;
                },
                iconStyle() {
                    return {
                        fontSize: (this.size || 24) + 'px',
                        fontVariationSettings: '"FILL" 0',
                        userSelect: 'none'
                    };
                }
            },
            template: `
                <span class="material-symbols-rounded" :style="iconStyle">
                    {{ iconName }}
                </span>
            `
        };
}
