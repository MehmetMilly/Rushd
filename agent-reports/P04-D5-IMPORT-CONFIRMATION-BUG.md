# P04-D5 import confirmation UX defect

## Scope

Fix only the candidate import-confirmation copy and visual intent, with a focused controller regression test. No import persistence, migration, reset, or deployment behavior is changed.

## Red regression loop

Command:

```text
node tests/application/p04-d5-import-confirmation.test.mjs
```

Before the implementation fix, the command failed deterministically:

```text
AssertionError [ERR_ASSERTION]: Arabic import confirmation must say استيراد

null !== 'استيراد'
```

The harness drives `importDataViaPorts` with a valid backup, checks the rendered confirmation state before confirmation, cancels once, then confirms once and counts the portability callback.

## Ranked hypotheses (before implementation)

1. **Candidate import call omits explicit action arguments.** If true, `confirmText` will remain the shared modal default (`null`) and `confirmColor` will remain destructive (`danger`), while the legacy import path will retain its explicit `importBtn`/`brand` arguments.
2. **The shared confirmation modal ignores supplied import action metadata.** If true, passing `importBtn` and `brand` at the candidate call site would not change `confirmDialog` state or rendered class selection.
3. **The iPhone build is loading stale or divergent translation data.** If true, `TRANSLATIONS.ar.importBtn` or `.en.importBtn` would not be `استيراد`/`Import` in the same source used by the regression harness.
4. **A later lifecycle/render step overwrites import dialog state.** If true, the state would initially be correct but change to the delete defaults before the dialog is painted or confirmed.

## Cause and fix

Hypothesis 1 was confirmed. The candidate `importDataViaPorts` call supplied only title, body, and callback to `showConfirmDialog`. That left the shared modal defaults active: `confirmText = null` (rendering the shared `Delete` fallback) and `confirmColor = 'danger'`. The legacy import path already passed `this.t.importBtn` and `'brand'`, which explains why the defect was limited to the candidate/physical-iPhone path.

The fix passes `this.t.importBtn` and `'brand'` through the candidate import call. This uses the existing bilingual translations (`استيراد` / `Import`) and existing non-destructive modal class mapping. Reset remains unchanged and continues to use the default `حذف` / `Delete` fallback with `danger` styling.

## Verification

Focused regression after the fix:

```text
node tests/application/p04-d5-import-confirmation.test.mjs
P04-D5 import confirmation regression passed
```

The regression proves:

- A valid candidate import opens confirmation without calling `restoreSnapshot`.
- Arabic action text is `استيراد` and English action text is `Import`.
- Import confirmation uses `brand` (non-destructive) styling intent.
- Cancel closes the dialog and performs no import.
- One confirmation performs exactly one portability restore callback.
- Reset retains the destructive fallback label and `danger` styling.

Neighboring checks:

```text
node tests/application/p04-d4-routing.test.mjs
p04-d4 routing passed

node tests/i18n-parity.test.mjs
Rushd i18n parity and duplicate-key gates passed.

npm run build
✓ built in 1.84s
```

The production build reports the existing dynamic-import/chunk-size warnings; it completes successfully.

## Owned files

- `src/app/root-controller.js` — candidate import confirmation now passes import copy and brand color.
- `tests/application/p04-d5-import-confirmation.test.mjs` — red-capable bilingual/callback/reset regression.
- `agent-reports/P04-D5-IMPORT-CONFIRMATION-BUG.md` — this evidence report.

## Limitations

No physical iPhone session was run by this agent. The deterministic controller seam reproduces the exact modal state that caused the screenshot symptom and the device-gate agent can perform the final device confirmation.

## Commit

`18bb63fa1eea1517a84d233e219d91fb82713d7e` — `Fix candidate import confirmation action`
