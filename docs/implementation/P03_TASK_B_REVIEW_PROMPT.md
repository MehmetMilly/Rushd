# Review P03 Task B before recovery work

You are Rushd's independent reviewer in `/Users/mehmet/Desktop/Rushd`. Use Grok 4.6 with High reasoning, or xHigh if the host exposes it. This review needs careful financial-state reasoning; report the actual selected setting. Review code and behavior, not the worker's confidence or test count.

Review product commit `e68926f01f6fabea4c4727d573d5028892fdd6c0`, parent `06c1ae0`, chiefly its changes to Task A correction `51659e6`. Later documentation-only commits may be present. Read `AGENTS.md`, `WORKFLOW_LITE.md`, `docs/implementation/P03_TASK_B_PROMPT.md`, final master plan section 3, and the worker report `artifacts/agent-reports/P03-B.md`. Consult Task A code only where B depends on it. Skip historical workflow machinery and P02 research.

This is read-only product review. Do not edit product files, commit, amend, push, or start Task C. Use temporary/ignored files for probes. Preserve existing work. Confirm source corresponds to the specified commit; if later product changes exist, use an isolated checkout rather than resetting this workspace.

## What matters

1. Availability conservation through expenses, partial payments, returns, linked corrections, obligations, buffers, and allocations. Independently derive expected amounts in several mixed sequences. Check correction of an expense that already has returns, repeated/reversed allocation actions, obligation overpayment, and unpaid-residual release. Review actual code in activity/obligation/allocation handlers and derived queries, not only the examples already passing.
2. Confirmation, explicit occurrence dates, stale revisions, repeat operation IDs and all-or-nothing writes for new multi-record actions. Reuse established Task A guarantees; investigate new paths and changed code instead of re-auditing all of A.
3. Semantic omissions. The worker deferred reversal/correction of returns to C even though B assigns actual-activity corrections. Determine the smallest required completion. It also resolves disputes on a return: test a partial refund and establish whether the resulting state/completeness can falsely suggest the disagreement is over. Check explicit reservation intent versus planned-not-reserved items, and whether changing an amount/category through correction can alter linked obligations unexpectedly.
4. Completeness and pacing: missing pool basis vs missing classification, unresolved disputed reservations, unsupported evidence states, and whether unknown values become affirmative money answers. Separate supported B cases from legitimate C-owned observations/proposals/mid-cycle recovery. Check currency/exactness and the assigned year-zero/era correction only as necessary for new behavior.

Use the worker summary as leads. For each material finding, give the requirement, exact code location, a reproducible production-API sequence, expected versus actual result, and the smallest fix. Identify scope gaps even when all tests pass. Do not invent another requirement or treat every C-owned feature as unfinished B work.

## Proportional verification

Run B's domain example/safety/completeness tests and its bounded property file once. Use isolated focused probes for suspected bugs. No browser matrix, dependency upgrades, benchmarks, arbitrary high-count fuzzing, or duplicated full-phase audit. Run other checks only when the diff or a concrete concern warrants them. Failures must not be concealed by modifying tests or production.

Task C covers recovery, recurring plans, observed boundaries, and cycle close/carry/reopen. Due-date/cross-cycle evolution and repository scalability can be recorded as C/D constraints. This review is brought forward because B is large and reports material semantic deferrals; it replaces that portion of the planned A–C review rather than adding a duplicate review later.

## Output

Save your report to **`/Users/mehmet/Desktop/Rushd/artifacts/agent-reports/P03-B-REVIEW.md`**, creating the directory if needed. This local report is ignored and should not be committed.

Include task ID, completion time, reviewed SHA, actual model/setting, verdict `ready_for_C` or `needs_changes`, material findings with reproductions, commands/results, and any legitimate C/D follow-ups. State verification limits honestly. Optional improvements do not block. If blocked by environment or time, save a partial report identifying the unresolved checks.

In chat, only confirm the report path. The founder tells Astra the review finished, and Astra reads it directly. If that path is inaccessible, say so rather than claiming it was saved.
