const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'docs/baseline/current/**',
      'public/vendor/**',
      'index.html'
    ]
  },
  js.configs.recommended,
  {
    files: ['eslint.config.cjs', 'tailwind.config.cjs', 'postcss.config.cjs', 'scripts/visual-parity.cjs', 'scripts/browser-smoke.cjs', 'scripts/legacy-idb-proof.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['scripts/smoke-check.mjs', 'scripts/font-license-guard.mjs', 'tests/font-license-guard.test.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    },
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['vite.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    },
    rules: {
      'no-console': 'off'
    }
  }
];
