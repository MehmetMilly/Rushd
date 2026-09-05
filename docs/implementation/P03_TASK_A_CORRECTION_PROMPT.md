# P03 Task A: two foundation corrections

Continue your Task A work in `/Users/mehmet/Desktop/Rushd`, branch `codex/rushd-rebuild-plan`, on commit `557c556`. Astra's focused review found two prerequisite issues. Fix these in one additive commit; do not start B or amend the existing commit. Preserve the Master's uncommitted implementation/routing documents and all unrelated edits. Use the current thinking mode; report only the tier the runtime actually exposes.

Read the relevant code and tests below; the original Task A scope and Workflow Lite still apply. No full-plan reread or process receipts are needed.

## 1. Bind the effective reversal date

`preview.ts:84-95` hashes the command and revision. `handlers.ts:278-306` derives `reverseInflow`'s financial date from the clock at execution. With an open payday cycle beginning 2026-09-25, previewing a reversal at `2026-09-30T20:59:59.999Z` in Asia/Riyadh shows September 30. Executing the unchanged confirmation at `2026-10-01T21:00:00Z` succeeds with October 2 as the financial date, at the same covered base revision.

Make the reversal's effective occurrence explicit in the command, using the existing civil-date/instant occurrence representation where suitable. Include it in canonical validation/preview binding and execute that exact occurrence, subject to cycle validation. Recording timestamps can reflect execution time; the confirmed financial date must not drift. A missing occurrence must receive an explicit typed validation result, not an ambient-clock default. Update public types, handlers, examples, and callers/tests consistently.

Add a regression through production preview/execute that changes the injected clock across Riyadh midnight without changing book revision. Assert the confirmed effective date is preserved, or a typed no-write failure occurs if it is no longer valid. Also prove altered occurrence with an old confirmation is rejected, and retrying the committed command returns its original receipt without another reversal.

## 2. Reject unsupported instants without throwing

`validation.ts:228-233` and `primitives/instant.ts:72-76` accept safe integers such as `Number.MAX_SAFE_INTEGER` that cannot be represented by JavaScript Date. Formatting them through Intl throws RangeError instead of returning a typed invalid-input result.

Validate representability before formatting, and enforce the existing supported civil-date range without silently normalizing unsupported dates or eras. Keep failures typed at both the public primitive and application command boundary. Add focused positive/negative out-of-range tests, plus an ordinary valid timestamp, and assert rejected commands leave state, operation journal, and outbox unchanged. Avoid a blanket catch that hides unrelated programming defects.

## Verify and finish

The independent check ran `npm exec -- vitest run tests/domain`: 7 files, 50 tests passed before these new cases. Use focused regressions during edits; at handoff run the Task A lint/typecheck, repository tests, bounded property tests, build, and diff check once. No browser/visual run is needed.

Commit only correction-owned source, tests, necessary source-manifest updates, and API documentation as `Rushd P03: bind reversal dates and reject invalid instants`. Do not push. Return SHA, what changed, commands/results, and unresolved issues. A's deterministic cycle IDs and in-memory repository are later C/D design seams, not additional correction requests. Stop after these fixes.
