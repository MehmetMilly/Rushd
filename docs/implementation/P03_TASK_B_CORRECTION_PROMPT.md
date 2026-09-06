# P03 B correction: reversals, refunds, and disputes

Continue your GLM B session in `/Users/mehmet/Desktop/Rushd`, branch `codex/rushd-rebuild-plan`, product base `e68926f`. Read `artifacts/agent-reports/P03-B-REVIEW.md`. The reviewer was Muse Spark 1.3, not Grok. Astra accepts F1–F5 with the decisions below, which override the review's suggested shortcuts and deferrals.

Fix these together within B's source/test/tooling ownership. Preserve the Master's uncommitted documents. Use Workflow Lite; no full-plan reread, process receipts, C implementation, amendments to previous commits, or push. Report the thinking mode actually exposed.

## Corrections

**F1: allocation reversals.** Availability ignores reversals that the tracked-pool reducer honors. Share effective funding/release derivation so both agree, retaining source/destination cycle attribution. Reverse-release re-earmarks money; reverse-funding restores it. Assignment/unassignment and their reversals do not change the total spending deduction. Do not substitute the entire cross-cycle tracked balance for the current cycle allocation delta.

**F2: corrected payments.** Obligation net payments must use unreversed effective expenses and effective returns, matching availability. A corrected 30 payment replaced by 10 is 10 paid, not 40. Enforce the resulting refund cap, including corrections made after returns. Preserve correction support for linked payments instead of disabling it.

**F3: refund caps across correction chains.** Complete this now, not in C. Preserve an explicit correction lineage so earlier refunds count against the current replacement. Reject shrinking below effective refunds or voiding while refunds remain, unless those refunds have first been corrected/reversed. A new replacement ID must not reset the refund allowance. Share effective-refund calculations across validation and queries.

**F4: explicit dispute resolution.** Neither partial nor full refund proves a dispute is over. Preserve the overlay unless resolution is explicitly requested and confirmed. Add a typed resolve-dispute action, or equally explicit confirmed resolution intent with a validated link/reason. A plain refund or reopening must not silently resolve it. Explicit final settlement/cancellation may resolve when the preview describes that effect. Residual-release uncertainty and other completeness reasons remain until their own conditions resolve. The review's net-payments-equal-zero shortcut is not the chosen policy.

**F5: correction of returns.** Implement linked reversal and optional atomic replacement for standalone expense returns and obligation returns. Preserve original facts. Update availability, obligation net payments, refund limits, and classification to use effective returns consistently. Enforce book/currency/target validity, bound occurrence, duplicate-reversal rejection, revision/idempotency, and atomic state+receipt+outbox. Remove the return-correction policy deferral. This is B's ordinary paid-activity correction work.

## Focused proof

Reproduce the review sequences, then add production-API regressions with independent hand-calculated expectations. Extend the existing bounded property sequence to include allocation reversal, expense correction, and return correction, which it currently misses.

- From 1,000, fund 200/assign/release 100 gives 900 available; reverse release gives 800. Separately, fund 200 then reverse funding gives 1,000 and zero funded balance.
- An 80 obligation paid 30 then corrected to 10 leaves 920 available and 70 reserved. Returning 40 is rejected. Cover payment correction when obligation returns already exist.
- Expense 100, return 80: replacement 50 and void are rejected without writes. Replacement 90 is valid, with only 10 additional refund available across old/new IDs. Repeat another correction to prove the lineage cap.
- Mistaken return 50 corrected to 10 against expense 100 gives 910 available and preserves history. Cover both return kinds, replay, duplicate correction, and injected failure between reversal/replacement writes.
- Partial/full refunds preserve an open dispute; explicit resolution removes only that reason. Reopening alone is not resolution.

Run targeted checks during edits. At handoff run lint, typecheck, repository tests, bounded property tests, build, and diff check once. No browser matrix or unrelated full audit. Update API docs/examples without weakening legitimate regressions.

## Handoff

Commit correction-owned files as `Rushd P03: reconcile corrections and financial derivations`. After committing, save the report to **`/Users/mehmet/Desktop/Rushd/artifacts/agent-reports/P03-B-FIX-01.md`**. Include task ID, complete/blocked status, timestamp, actual base/result SHA and runtime setting, F1–F5 dispositions, commands/results, and remaining issues. The report is ignored; do not commit it or overwrite the original reports.

In chat, simply confirm the report path. Stop after these corrections. Astra will arrange focused verification of the findings and new interactions, not another full B audit.
