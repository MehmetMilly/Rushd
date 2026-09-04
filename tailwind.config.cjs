/**
 * Tailwind v3 build-time configuration for the legacy Rushd entry.
 *
 * Keep this configuration byte-for-byte equivalent to the former Play CDN
 * extension.  The utility class names remain owned by the legacy templates;
 * later phases may move those templates into src/ without changing these
 * tokens.
 */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{html,js,mjs,ts,jsx,tsx,vue}'
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--twc-canvas) / <alpha-value>)',
        surface: {
          1: 'rgb(var(--twc-surface-1) / <alpha-value>)',
          2: 'rgb(var(--twc-surface-2) / <alpha-value>)',
          3: 'rgb(var(--twc-surface-3) / <alpha-value>)'
        },
        brand: {
          DEFAULT: 'rgb(var(--twc-brand) / <alpha-value>)',
          light: 'rgb(var(--twc-brand-light) / <alpha-value>)'
        },
        success: { DEFAULT: 'rgb(var(--twc-success) / <alpha-value>)' },
        danger: { DEFAULT: 'rgb(var(--twc-danger) / <alpha-value>)' },
        warning: 'rgb(var(--twc-warning) / <alpha-value>)',
        glass: 'var(--glass-panel-border)'
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        'sans-ar': ['IBM Plex Sans Arabic', 'Noto Kufi Arabic', 'sans-serif'],
        'display-ar': ['Noto Kufi Arabic', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      }
    }
  }
};
