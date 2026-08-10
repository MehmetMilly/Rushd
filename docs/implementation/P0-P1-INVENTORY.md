# Canonical P0/P1 Baseline Inventory

**Authority:** Every item below requires an executable reproduction or explicitly justified
manual reproduction in P00, then a verified fix or safe visible dogfooding containment in
P01. P01 also records the final owning phase for any containment; the listed defect cannot
remain silently reachable while later architecture work proceeds.

## P0 — corruption, duplication, erasure, or material misstatement

- **P0-01 Paid plan history mutation:** plan reapplication eligibility ignores paid state
  (`index.html:5113-5130,6314-6349`).
- **P0-02 Partial plan application:** delete/update/create/assignment writes are sequential
  and non-atomic (`index.html:6371-6402`).
- **P0-03 Partial import:** validation and sequential writes can leave a partially imported
  database (`index.html:9793-9857`).
- **P0-04 Duplicate/non-atomic settlement:** vault credit and settlement record are separate;
  retry can duplicate (`index.html:5830-5878`).
- **P0-05 False cycle surplus:** unpaid reserved obligations are excluded from settlement
  surplus (`index.html:5830-5878`).
- **P0-06 Goal double counting:** every goal compares itself with the full vault balance
  (`index.html:8339-8351`).
- **P0-07 Legacy vault disappearance:** once transaction history exists the standalone
  legacy balance can be ignored (`index.html:5759-5878`).
- **P0-08 Dangerous reset blockage:** another tab can block deletion indefinitely and some
  preferences survive (`index.html:9859-9915`).

## P1 — high-priority correctness and resilience

- **P1-01 UTC local-date error:** “today” is derived through UTC and can select the wrong
  Riyadh/local date (`index.html:2464-2474`).
- **P1-02 Floating-point money:** production stores and calculates major-unit JavaScript
  numbers despite integer-money comments (`index.html:2437-2461,4949-4952`).
- **P1-03 Historical budget rewrite:** one mutable allowance changes apparent prior cycles
  (`index.html:5572-5576,5767-5769`).
- **P1-04 Home date/month mismatch:** the selected date changes visible context while the
  amount uses the real current cycle (`index.html:5993-6105,6405-6410`).
- **P1-05 False weekly pace:** monthly remaining is divided by four regardless of days
  (`index.html:8453-8458`).
- **P1-06 Missing monthly schedule day:** a created monthly template can never occur.
- **P1-07 Ignored assignment effective date/profile:** plan resolution can use the edited
  profile rather than the assigned revision/date.
- **P1-08 Stale derived state:** rapid date changes can publish an older statistics result.
- **P1-09 Weak numeric validation:** negative, excessive precision, non-finite, and
  Arabic/Western input boundaries are not consistently enforced.
- **P1-10 Weak import schema:** the validator meaningfully checks little beyond an expenses
  array (`index.html:9793-9857`).
- **P1-11 Hard-coded/nonfunctional analytics:** profile trend input is hard-coded and date
  activity dots are disabled (`index.html:10047-10072,10169-10173`).
- **P1-12 Current gamification misincentive:** `1 SAR saved = 10 XP` and wealth/underspend
  badges optimize the wrong behavior (`index.html:9962-10000`).

## P00 evidence contract

For every ID, record:

- Reproduction type: automated or manual.
- Sanitized fixture and exact preconditions.
- Command/steps and expected current result.
- Captured current result.
- Whether P01 fixes it or visibly blocks the dangerous path.
- Regression test owner and final evidence path.

P00 baseline visual evidence uses Playwright-pinned Chromium with the browser version
recorded, PNG screenshots, and WebM/MP4 motion recordings under
`docs/baseline/current/<language>/<theme>/<viewport>/`. Required viewports are phone
390x844, tablet 1024x1366, and laptop 1440x900. Capture Arabic and English, light and dark,
empty and populated states, all current permanent screens, onboarding, add/edit flow,
important modals, error/loading states available in the prototype, keyboard focus, and
current motion profiles.

The P00 manual attestation is `docs/baseline/P00-manual-qa.json`, matching
`docs/implementation/human-attestation-template.json`, with tester/task identity, UTC/local
time, device/browser/OS, checklist requirement, evidence paths, result, and limitations.
