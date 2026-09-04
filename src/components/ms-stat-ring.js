// Mechanically extracted P02 runtime template. SFC conversion is deferred to P05/P06.
export function createMsStatRing(environment = globalThis) {
    const { navigator, performance, setTimeout, clearTimeout } = environment;
    return {
            props: {
                radius: { default: 60 },
                stroke: { default: 8 },
                progress: { default: 0 }, // 0 to 100
                color: { default: 'var(--c-accent-brand)' }
            },
            computed: {
                normalizedRadius() { return this.radius - this.stroke * 2; },
                circumference() { return this.normalizedRadius * 2 * Math.PI; },
                strokeDashoffset() {
                    return this.circumference - (this.progress / 100) * this.circumference;
                }
            },
            template: `
                <svg :height="radius * 2" :width="radius * 2" class="stat-ring">
                    <circle
                        :stroke="color"
                        stroke-opacity="0.2"
                        :stroke-width="stroke"
                        fill="transparent"
                        :r="normalizedRadius"
                        :cx="radius"
                        :cy="radius"
                    />
                    <circle
                        class="ring-progress"
                        :stroke="color"
                        :stroke-width="stroke"
                        :stroke-dasharray="circumference + ' ' + circumference"
                        :style="{ strokeDashoffset: strokeDashoffset }"
                        stroke-linecap="round"
                        fill="transparent"
                        :r="normalizedRadius"
                        :cx="radius"
                        :cy="radius"
                    />
                </svg>
            `
        };
}
