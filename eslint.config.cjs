const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'docs/baseline/current/**',
      'public/vendor/**',
      'index.html',
      // P02 moves these legacy files without rewriting them. Their explicit
      // TypeScript exemptions name P03/P04/P05/P06 as their future owners.
      'src/app/root-controller.js',
      'src/data/legacy-v1/runtime.js',
      'src/shared/core.js',
      'src/components/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['eslint.config.cjs', 'tailwind.config.cjs', 'postcss.config.cjs', 'scripts/visual-parity.cjs', 'scripts/browser-smoke.cjs', 'scripts/legacy-idb-proof.cjs', 'scripts/capture-p00-baseline.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-redeclare': 'off'
    }
  },
  {
    files: ['scripts/smoke-check.mjs', 'scripts/font-license-guard.mjs', 'scripts/production-source.mjs', 'scripts/extract-p02-legacy.mjs', 'tests/font-license-guard.test.mjs', 'tests/i18n-parity.test.mjs'],
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
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: globals.serviceworker
    },
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['public/retire-rejected-shell.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: globals.browser
    }
  },
  {
    files: ['scripts/p04d-rollback-harness.mjs', 'tests/rollback/retirement-contract.test.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-console': 'off'
    }
  }
];
