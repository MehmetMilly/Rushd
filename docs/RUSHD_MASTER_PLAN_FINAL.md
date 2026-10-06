# Rushd Final Product and Technical Master Plan

**Status:** Decision-complete implementation authority

**Prepared:** 10 August 2026

**Repository baseline:** `ed45d83d235e230f9d530de6c421f68c3dd5020b`

**Founder-friendly version:** [`RUSHD_FINAL_FOUNDER_BRIEF.md`](./RUSHD_FINAL_FOUNDER_BRIEF.md)

**Execution authority:** [`RUSHD_EXECUTION_PROTOCOL.md`](./RUSHD_EXECUTION_PROTOCOL.md)

## 1. Authority and outcome

This document merges the July master plan, the founder review, the August discussion,
the locked navigation decision, repository audit, product research, behavioral research,
motion research, backend analysis, and QA research.

When this document conflicts with any of the following, this document wins:

- `RUSHD_MASTER_PLAN.md`
- `RUSHD_FOUNDER_REVIEW.md`
- `RUSHD_PRODUCT_DISCUSSION_2026-08-10.md`
- `RUSHD_FOUNDER_FEEDBACK_2026-08-10.md`
- Current aspirational sections of `docs/roadmap.md`, `docs/data-model.md`,
  `docs/architecture.md`, and `docs/privacy-notes.md`

The old files remain evidence of how decisions were reached. They are not implementation
instructions.

On 10 August 2026 the founder explicitly delegated the remaining research-backed product,
technical, and workflow decisions for this setup and asked that work proceed without new
input unless an external action genuinely requires it. Under that authority this plan
selects the exact launch Momentum mechanics and an eval-controlled provider gateway below.
OpenAI is the provisional first candidate—not a research-proven winner—and must win the
same frozen provider benchmark as any production alternative. Both decisions remain
subject to pre-registered quality/pressure gates, not ad hoc weakening.

The required outcome is a complete, publishable, installable web app that:

- Feels native and exceptional on phones while being intentionally designed for tablets
  and laptops.
- Works offline for the entire non-AI core.
- Offers accounts and reliable multi-device cloud synchronization at launch.
- Uses AI deeply across capture, onboarding, plans, goals, insights, editing, and
  financial conversation.
- Preserves deterministic, explainable financial truth.
- Is equally deliberate in Arabic/RTL and English/LTR.
- Uses unusually ambitious, joyful motion without sacrificing input responsiveness,
  accessibility, or data safety.
- Motivates daily use through a high-quality Momentum system.
- Splits the current 10,194-line prototype into a maintainable Vue/TypeScript codebase.

## 2. Product thesis

### Audience

Rushd is for younger people who manage one dominant pool of spending money: students,
interns, allowance or scholarship users, early earners, and people with tight budgets or
overspending problems.

The audience is behavioral, not national. Arabic and English are equal-quality launch
languages. Locale, direction, currency, number formatting, timezone, week start, and
cycle anchor are profile settings. One profile uses one base currency at launch.

External beta and public launch are **18+ only**. “Younger” means younger adults; minors,
child-directed onboarding, parental consent, and child-data/AI processing are out of scope
until a separately founder-approved legal/privacy/product architecture exists. Onboarding
uses a clear age self-attestation and safe under-18 exit without collecting a full birth
date unless qualified legal advice requires it. Account creation, AI, telemetry, and beta
enrollment cannot bypass this boundary.

Every primary destination header exposes the same persistent Profile/Settings action; it
does not become a sixth permanent tab. Settings owns language/locale, timezone/week start,
cycle settings, notification and motion preferences, privacy, import/export, account,
sessions/devices, data deletion, and support diagnostics.

### Core job

> After actual spending, remaining commitments, and deliberate allocations, show how
> much is genuinely available for additional spending now—and explain why.

### Differentiated wedge

AI capture and a “money left” number are not unique by themselves. Rushd must lead with:

> Expected versus actual reconciliation, fast recovery from tracking gaps, a reliable
> pool reality-check, bilingual conversation, and deterministic explanations.

### Product boundary

Version 1 is one spending pool, one active cycle, and one active plan. It is not bank
aggregation, double-entry accounting, investing, debt optimization, household finance,
multi-currency accounting, payment custody, or regulated financial advice.

## 3. Financial truth contract

### Canonical amounts

The primary amount is **Available for extra spending**. Final Arabic copy must be chosen
through comprehension testing; a literal translation is not authoritative.

```text
available for extra spending =
  cycle starting funds
  + approved carry-in and inflow adjustments
  + signed reconciliation adjustments
  - net actual outflows in the cycle
  - unpaid items explicitly reserved as commitments
  - confirmed goal/vault allocations sourced from this cycle
  - explicit buffer reservation
```

Rules:

- Money uses integer minor units and an ISO currency code. The currency definition owns
  its exponent; the system must not assume every currency has two decimals.
- Every Reality Check observation and its resulting reconciliation adjustment use the
  active book's ISO currency. The active currency is visibly labeled beside the input and
  announced in voice/accessibility copy. Rushd performs no foreign-exchange conversion:
  an explicit mismatched currency or an ambiguous symbol must produce clarification and
  no write, never reinterpretation as the active currency.
- Dates are local civil dates in the profile timezone. Timestamps are for event ordering.
- Categories describe; they never control arithmetic or morality.
- A planned flexible limit is guidance and is not subtracted twice.
- A payment replaces its linked reservation. If expected 80 becomes actual 65, 15 is
  released to availability only when the user marks that obligation finally settled.
- A lower actual amount is variance, not “savings.” It becomes goal savings only after an
  explicit allocation.
- Availability may be negative. Show “Short by X”; never silently clamp it to zero.
- Pacing is a separate derived scenario: available amount divided over the remaining
  user-selected eligible days. It never becomes another source of truth.
- Every number has a breakdown, data-as-of time, calculation version, and completeness
  state.

### Mid-cycle boundary and reconciliation semantics

A cycle begins in one of two explicit modes:

- `full-cycle`: starting funds describe the pool at the cycle start and all activity in
  the cycle affects availability.
- `remaining-from-boundary`: `observedPoolMinor`, `boundaryLocalDateTime`, and timezone
  describe what remained at a mid-cycle cutoff. Activity before the boundary can improve
  historical Insights but does not subtract again from the current pool unless the user
  explicitly rebases the boundary.

A Reality Check at time T accepts an observation only in the active book's ISO currency
and creates a same-currency signed reconciliation adjustment equal to the observed pool
balance minus the ledger-derived pool balance at T. The UI must show the ISO currency in
text, not rely on a potentially ambiguous symbol. Typed or spoken input that explicitly
names another currency, or uses a symbol that cannot be resolved unambiguously to the
active currency, is a clarification-only non-write; version 1 never performs FX. If an
activity dated at/before T is later recovered, the unexplained adjustment is reduced by
the same net amount so the observed pool is not double-counted. Activity after T changes
the pool normally. Replacing, splitting, or deleting an adjustment is a visible correction
action.

Completeness has two recorded dimensions: **pool completeness** and **classification
completeness**. A Reality Check can make the pool Current while leaving merchant/category
analysis Needs Attention.

Completeness is a deterministic reducer, not a manually toggled badge:

- Pool completeness derives from the latest valid full-cycle start or observed boundary,
  all later pool-changing actuals/returns/adjustments, reviewed material commitments, and
  unresolved proposals. A new boundary/rebase may restore it; a stale/unresolved event may
  degrade it. Recovering pre-boundary activity reduces the linked adjustment while keeping
  the observed pool invariant.
- Classification completeness derives from the classified share of the same covered pool
  movements. Accepting a fully classified recovered transaction reduces the unclassified
  residual and can improve this dimension; an unclassified adjustment keeps it Needs
  Attention. Resolving a pending proposal, commitment classification, split, reversal, or
  replacement recomputes it.
- Every reducer event records its source, boundary, affected dimension, data-as-of time,
  and calculation version. Backdated/reversed events recompute forward; no UI action may
  declare Current without the reducer conditions.

### Completeness and recovery

States:

- **Current:** pool boundary, material commitments, and pending proposals are reconciled.
- **Needs attention:** a useful estimate exists but known gaps remain.
- **Records only:** derived only from recorded activity and must not imply certainty.
- **Unavailable:** there is no honest basis for a decision amount.

The flagship recovery mechanism is a 10–15 second **reality check**:

1. The user enters or says how much is actually left in the pool while Rushd visibly and
   accessibly names the active ISO currency.
2. Rushd shows the unexplained difference.
3. AI can help reconstruct forgotten activity.
4. The user accepts remembered transactions or an explicit reconciliation adjustment.
5. The observed pool is refreshed. The headline becomes Current only when every pool-
   completeness reducer condition is satisfied; otherwise it stays Needs Attention and
   names the remaining proposal, commitment, stale-boundary, or other cause. Category and
   merchant analytics remain incomplete while any difference is unclassified.

### Cycle model

Launch supports a Gregorian recurring monthly cycle anchored either to the first of the
month or to a chosen payday. Short-month behavior is explicit: use the last valid day.
Irregular/non-monthly cycles are deferred. Calendar display may be localized without
changing financial period semantics.

Timezone, week-start, and payday edits are versioned settings with explicit effective
dates. By default they affect only the next unopened cycle. Existing actuals keep their
captured local civil date, timezone, and cycle identity; closed cycles never move. Changing
the open cycle requires a previewed explicit rebase that closes/reverses the current cycle
version, creates a new boundary/version, and visibly propagates any carry/allocation delta.
Display-timezone changes never silently re-date activity. Test short months, UTC-offset
crossing, DST where applicable, forward/backward payday moves, retries, and reopen.

### Partial payment and obligation state

An expected commitment can be open, partially settled, finally settled, cancelled, or
disputed. It may have multiple append-only payment, return, reversal, and correction
entries.

For an open commitment with expected amount E and unreversed net payments P:

```text
residual reservation = max(0, E - P)
availability effect = net actual outflows P + residual reservation
```

Thus paying 30 of an expected 80 leaves a reservation of 50; it neither releases the full
80 nor double-subtracts 30. A final settlement closes the residual reservation at the
confirmed final net amount and releases/consumes the variance. Cancellation releases the
residual only after confirmation. A return increases the pool but does not silently reopen
the obligation; reopening is an explicit action. Corrections use linked reversal and
replacement records, never invisible overwrites.

`disputed` is an overlay on paid/unpaid state, not free money. Posted disputed payments
remain actual outflows until a real return/chargeback entry occurs. Any unpaid residual
remains reserved by default; the user may pause that residual only through a previewed,
audited reservation-release action that marks availability Needs Attention. Expected
refunds never increase availability. Resolution links the return, cancellation, final
settlement, or reopened residual without overwriting the dispute history.

### Planned and actual activity

Expected items and real cash movement are separate entities. Default transaction history
shows actual money movement. Upcoming/reserved/unresolved items appear distinctly and
cannot be mistaken for spending.

Paid history is immutable through correction records. A recurring plan may change future
and unpaid managed occurrences; it may never rewrite a paid or detached fact.

### Cycle close, carry, and reopen

Cycle close creates one immutable, idempotent settlement identified by book, cycle, and
settlement version. It snapshots funds, actuals, signed adjustments, still-reserved
commitments, allocations, buffer, availability/shortfall, and completeness.

- Still-open reserved commitments remain reserved and retain their original due cycle;
  they are not called surplus. Their later cash movement belongs to its actual occurrence
  cycle while staying linked to the original expectation.
- Positive free remainder is not moved automatically. The user explicitly carries it into
  the next cycle, funds the tracked allocation pool, splits it, or leaves the next cycle to
  start independently.
- A shortfall is visible and never silently carried. The user explicitly carries it,
  changes a reservation/fund boundary, or records a correction.
- Carry-in is created only from a named settlement action and can be applied once.
- Reopening uses a reversal/new settlement version. Backdated activity never rewrites a
  closed snapshot; it creates a correction action and a visible propagated delta to any
  affected carry/allocation in later cycles.

Legacy `vault` close decisions migrate to one tracked-allocation funding movement; legacy
`budget` decisions migrate to one named carry-in. Missing, duplicate, or ambiguous
settlements enter Needs Attention and cannot be silently re-settled.

### Goals and allocations

Rushd records the user's allocation intention. It does not hold, transfer, or protect real
money. Each goal has its own allocation; the same pool cannot satisfy multiple goals.
Allocation/release/reversal actions are atomic, idempotent, auditable, and undoable where
mathematically safe.

Funding the tracked allocation pool from spendable money reduces availability exactly
once. Assigning already-funded unallocated tracked money to a goal has no further
availability effect. Releasing tracked money returns it to one explicitly named cycle as
an inflow adjustment and reduces goal/unallocated balances atomically. Cross-cycle source
attribution is retained. Legacy vault balance becomes one unallocated opening movement;
legacy goals receive no inferred allocation.

## 4. Information architecture

### Locked permanent navigation

1. Home
2. Plan
3. Ask Rushd
4. Insights
5. Goals

This hierarchy never changes by device. A phone uses bottom navigation. Larger layouts
may use a sidebar/rail, visible detail pane, pointer affordances, and keyboard shortcuts,
but no destination is promoted or demoted.

### Home

Home contains, in priority order:

1. Available-for-extra-spending hero, completeness/freshness, short breakdown, and
   optional pace-to-cycle-end.
2. Primary Add Expense action and direct microphone control.
3. Selected-day actual transactions and prominent View All Transactions.
4. One urgent attention/reconciliation item when present.
5. Momentum check-in/journey entry.
6. One contextually useful insight.
7. Notification-center button in the header.
8. Account/offline/sync state only when it needs attention.

The Add Expense menu contains Smart text/voice, Manual, saved flexible preset, and—after
the capture eval gate—Receipt/photo/screenshot. All produce normal canonical activities.

### Full transaction history

This is a secondary screen, not a permanent tab. It provides period browsing, search,
filters, details, correction/reversal, linked returns, bulk review, exports, and audit
receipts. User-facing language must say what happened; internal ledger terminology must
not leak into simple flows.

### Plan

Plan owns:

- Cycle/payday and starting pool.
- Reserved commitments and recurring rules.
- Flexible definitions, limits, and saved presets.
- Buffer.
- Templates/plan profiles and preview-before-apply.
- Expected-versus-actual reconciliation.
- Cycle close and next-cycle preparation.

The common path stays simple; advanced schedule rules appear progressively.

### Ask Rushd

Ask Rushd is the full conversation destination and action history. It supports grounded
discussion, what-if scenarios, multi-step instructions, batch proposals, clarification,
and voice conversation when enabled. It never replaces contextual AI elsewhere.

The global Ask control is a contextual quick composer, not a separate assistant. It carries
the current screen/entity context with an explicit removable context chip. **Open full
conversation** navigates to the one Ask Rushd destination while preserving the same thread,
draft, proposals, and action history. Arabic/English labels and accessible names stay
consistent across both entrances.

### Insights

Insights answers concrete questions:

- What changed and why?
- Am I spending faster or slower than my selected pace?
- How did expected and actual amounts differ?
- How are flexible limits progressing?
- What patterns exist by category, merchant, time, or cycle?
- What happens if I spend, reserve, defer, or allocate a chosen amount?

Charts have accessible table/text equivalents and do not moralize spending.

All derived insights inherit the primary completeness state. Current data may produce a
definitive deterministic result. Needs Attention or Records Only must state assumptions and
offer Reality Check. Unavailable suppresses affirmative affordability, pace, or contribution
advice rather than guessing.

### Goals

Goals shows target, allocated amount, **tracked but not allocated** amount, progress,
history, and scenario-based contribution suggestions. The tracked-but-not-allocated value
is shown only when its calculation is supported by the current completeness state and is
never presented as held money. Goal suggestions inherit the same completeness/assumption
rules as Insights. Allocation wording never implies custody.

### Notifications

The Home button opens a lightweight center for sync failures, AI proposals awaiting
review, due/reconciliation items, cycle review, achievements, and product notices. It is
not a social inbox or a second task manager. Lock-screen copy contains no merchant or
amount details by default.

Push permission is requested only after the user explicitly enables a reminder. Routine
and streak-risk reminders are separate, off by default, and separately revocable. Every
notification uses generic lock-screen copy and deep-links to a focused, authenticated and
offline-safe resolution state; it never drops the user onto an unexplained dashboard.

## 5. AI product and safety architecture

### Four connected surfaces

1. Global Ask Rushd control available throughout the app.
2. Direct Smart Add and microphone entry on Home.
3. Contextual AI controls inside Plan, Insights, Goals, and transaction detail.
4. Full conversation in Ask Rushd.

All four surfaces share the same threads, action registry, permissions, proposal state,
and audit history. Contextual entry changes the starting context, not the assistant's
identity or authority.

### Launch capability

AI requires connectivity and a signed-in account. It supports:

- Arabic, English, and mixed-language typed or push-to-talk capture.
- Single and batch transactions across dates and cycles.
- Receipt/photo/screenshot extraction behind the same review step.
- Corrections, linked returns, and matching to expected/flexible items.
- AI-assisted onboarding and plan extraction.
- Bounded plan/template/goal proposals.
- Grounded explanation of availability and insights.
- Deterministic what-if and “Can I spend X?” scenarios.
- Conversation using current, permissioned context.
- User-visible, editable merchant/category preferences and assistant memories.

Cross-domain instructions may contain several actions, but each action must be typed and
individually inspectable. Spoken responses and real-time duplex voice can ship after the
push-to-talk and conversation eval gates; the architecture should not block them.

### Authority model

The universal path is:

```text
user input
  -> context minimization
  -> model interpretation
  -> typed action proposal(s)
  -> deterministic validation and calculation
  -> before/after preview
  -> user confirmation appropriate to impact
  -> atomic command execution
  -> action receipt + sync operation
  -> undo/reversal when allowed
```

The model cannot directly write local or cloud data, calculate canonical totals, bypass
validation, silently import/reset, or claim real money moved. Read-only questions do not
need confirmation. Simple capture can use one compact review; destructive, broad, stale,
or ambiguous batches receive stronger review.

### AI implementation

- Put every provider behind an authenticated server function and versioned adapter.
  OpenAI Responses API is the provisional first implementation candidate, not a presumed
  benchmark winner. Before production lock, compare it with at least one production-
  eligible alternative on the same frozen holdout, latency, Arabic/English quality,
  privacy/retention, regional availability, operational controls, and measured cost.
- Select the provider/configuration that passes every hard gate and best satisfies the
  pre-registered weighted decision record. A provider may be replaced without changing
  the command/action or financial domain.
- Use strict structured outputs/tool schemas and a versioned action registry.
- Treat model/provider choice as an eval-controlled configuration, not a permanent code
  assumption.
- Use recorded-audio transcription for reliable capture first; add Realtime voice only
  after independent quality, latency, interruption, and privacy testing.
- Set provider storage/retention intentionally and minimize raw finance context.
- Redact operational logs; do not send raw amounts, merchants, prompts, audio, or model
  output to product analytics/error telemetry.
- Maintain a versioned Arabic/English/mixed-language eval corpus and regression cases for
  ambiguity, dates, numeric forms, multi-action commands, stale state, prompt injection,
  timeout, malformed output, and unauthorized operations.

### Pre-registered AI release gates

Before model/prompt tuning sees the release holdout, freeze at least 1,200 synthetic,
consent-safe reviewed cases. Language is an orthogonal stratum: at least 400 Arabic, 400
English, and 400 mixed-language cases. Mutually exclusive primary-modality strata include
at least 500 text, 300 recorded voice (at least 100 normal/noisy conditions), 200 receipt/
image, and 200 contextual multi-turn cases. Primary capability strata include at least 400
capture/correction, 200 batch/cross-cycle, 150 plan/goal mutation, 150 grounded discussion/
what-if, 100 onboarding, and 200 adversarial/failure cases. Reserve 30% as an untouched
release holdout, with every language, modality, capability, impact, and ambiguity stratum
represented. Publish exact denominators and Wilson confidence intervals; abstentions count
as failures unless the gold label requires clarification/non-write.

Scoring definitions:

- **Critical-slot accuracy:** exact correct gold values divided by every gold amount,
  currency, direction, local date, target, and action-type slot; no slot is removed because
  parsing failed.
- **End-to-end task success:** the exact intended proposal/action set, clarification, or
  refusal is produced with no missing, extra, or unauthorized action and reaches the
  correct reviewed UI state.
- **Batch recall/precision:** gold actions recovered / gold actions, and correct proposed
  actions / all proposed actions, including hidden omissions.
- **Receipt/image field accuracy:** exact gold amount, currency, date, merchant, and line/
  total relationship on supported images; unsupported/low-confidence inputs must abstain.
- **Grounding:** every financial assertion agrees with supplied deterministic facts and
  exposes its data-as-of/calculation basis; an invented amount is critical.

Hard gates:

- 100% of gateway outcomes are either a schema-valid typed proposal or a truthful non-write;
  no malformed result reaches the client. First-attempt schema validity is >=99.5%.
- 100% canonical arithmetic agreement with the deterministic domain.
- 0 unconfirmed canonical writes, unauthorized/extra high-impact actions, cross-user
  context exposure, critical prompt-injection successes, invented financial amounts, or
  hidden batch omissions.
- Critical-slot accuracy >=99.5% overall and >=99.0% in each language and primary modality.
- End-to-end task success >=98% overall, >=95% in every language/modality/capability
  subgroup, and >=99% for high-impact plan/goal/bulk mutations.
- Batch action recall >=99% and precision >=99.5%; any missing high-impact action blocks.
- Correct clarification/non-write >=98% overall and >=97% in every language/modality group.
- Receipt/image required-field accuracy >=97.5% overall and >=95% in each supported image
  condition; noisy recorded-voice end-to-end success >=95%.
- Grounded read/discussion answers >=98% by frozen rubric, with zero invented amounts.
- 100% timeout, malformed output, offline, stale proposal, retry, and kill-switch cases end
  in a truthful non-write state.
- Human review of every critical error plus a frozen 20% stratified sample; any zero-
  tolerance error blocks release regardless of aggregate score.

The provider benchmark uses these same gates first. Among passing candidates, the frozen
decision record weights end-to-end quality 45%, Arabic/mixed quality 20%, latency 15%,
privacy/retention/regional controls 15%, and measured cost 5%. Prompt, model, schema, tool,
context policy, or provider changes rerun the frozen holdout. New real-world corrections
become sanitized regression cases without contaminating the original holdout.

## 6. Onboarding contract

The first session must show value before demanding exhaustive setup.

### Fast route

1. Language/direction and locale/currency.
2. Auto-detected timezone and week start, visibly confirmed or changed before calculation.
3. Cycle anchor/payday and current boundary.
4. One real expense by manual, text, or voice when online/signed in, otherwise manual.
5. Immediate Home preview and one deterministic scenario.
6. Optional sign-in to sync and unlock AI.

### Smart setup route

After optional sign-in and while online, the user speaks or types freely about the money
cycle, commitments, routines, flexible spending, and goals. AI proposes a structured setup
in one review, calls out ambiguity, and lets the user accept, edit, skip, or continue
manually. Guests and offline users receive a field-equivalent guided manual setup plus a
clear **Use Smart Setup after sign-in** route; Fast Start is never blocked.

Both routes support starting mid-cycle, unknown past spending, importing a backup, staying
as a guest, or signing in. Guest-to-account migration is an explicit choice. Onboarding
progress can resume after interruption and never traps the user in an unfinished modal.

## 7. Momentum retention system

### Objective

Optimize for a **Guided Cycle**: funds established, records/reconciliation performed in at
least three distinct weeks, and cycle review completed or deliberately deferred. Do not
optimize raw time in app, number of transactions, amount spent, or underspending.

### Daily check-in streak

A date earns one idempotent check-in mark when the user closes it by:

- Reviewing recorded spending and resolving due items.
- Confirming there is nothing else to add.
- Completing a short catch-up for that date.

Corrections preserve the completed date and are labeled corrected. Backfill improves
records but does not create multiple current streak increments. A 48-hour repair window
requires real review. One repair token may be earned by a weekly review and cannot stack
beyond one, be purchased, or be gifted.

After expiry, preserve longest streak, journey, mastery, and collectibles. The return
flow says Start Today, not You Failed. The user chooses the day boundary/reminder context.
One routine reminder and one separately opt-in risk reminder are the maximum defaults.

A check-in means **reviewed as of a visible local time**, not a claim that future spending
cannot occur. A final close is offered at or after the configured cutoff. An earlier review
may earn the same one mark, but later activity changes the label to **reviewed, later
activity added** and prompts a lightweight re-review without duplicating or destroying
progress.

### Progress and rewards

Launch includes:

- An animated private cycle journey.
- Six permanent mastery cards: first clear picture, honest correction, realistic plan,
  return after a gap, weekly compass, and cycle review/backup readiness.
- One user-chosen weekly mission from three non-monetary record-quality actions.
- Cosmetic themes, scenes, profile frames, transition styles, alternate icon, and summary
  cards.
- Transparent “why this counted,” hide-streak, reduced-motion, and correction controls.

Do not award progress for amount, wealth, transaction count, categories, or app opens. No
leaderboards, random loot, paid protection, artificial scarcity, or locked core features.
Instrument farming signals, pressure feedback, reminder opt-out, corrections, lapse
recovery, D7/D28 return, and Guided Cycle. Run a four-week closed beta before claiming
behavioral effectiveness.

Pre-register the beta pressure gate before exposing streak-loss mechanics. Enroll at least
40 consented testers; after a common seven-day review-only baseline, randomize at least 20
per arm for two weeks to Momentum versus review-only, then offer Momentum to all for the
remaining period. Each arm must retain at least 16 activated testers through the randomized
period, at least 14 per arm must answer both weekly pressure pulses, and overall week-four
retention must include at least 28 testers. Treat nonresponse as missing—not positive—and
report assigned, activated, responding, retained, and excluded denominators. More than a
15-point differential attrition/nonresponse gap is itself blocking unless a documented
non-product cause is independently verified; otherwise recruit and rerun the gate.
Immediately pause risk reminders and streak-loss pressure, then rerun at least two weeks,
when any of these occur:

- >=15% of weekly respondents rate “pressured or judged” 4–5/5, or the rate is >=10
  percentage points above review-only.
- Notification opt-out is >=10 percentage points above review-only.
- Truthful correction rate falls >=20% relative to baseline/holdback without an offsetting
  improvement in verified completeness.
- Create/delete bursts or transactions-per-mark rise >=25% without verified completeness
  improvement, indicating farming.
- Any severe complaint links Rushd pressure to concealed spending, unsafe deprivation, or
  material distress; this triggers immediate human review regardless of denominator.

If the reduced version fails the same gate, launch with streak/risk pressure off and keep
only the daily review, journey, mastery, and user-controlled mission layers. A retention
lift never overrides a harm threshold.

## 8. Visual, interaction, and motion system

### Direction

Founder clarification, 11 September 2026: evolve the existing Rushd visual identity.
The preserved interface and `docs/baseline/current/` screenshots are the starting
reference for composition, density, typography roles, colors, cards, day strip,
ledger, navigation treatment, and capture interactions. Improve their finish,
responsiveness, accessibility, and motion without substituting a different visual
direction. Required financial semantics and the locked destination hierarchy still
apply; preserving appearance does not require retaining obsolete behavior.
Technical migrations and later-phase placeholders do not authorize replacing the
visible app with a generic shell. Compare changed screens against the baseline
in Arabic and English, light and dark, and mobile and wider layouts. Consequential
departures require an explicit founder design decision based on a visible proposal.
References to UI replacement below mean implementation replacement within this
direction, not permission to discard the established design.

The product should feel premium, elegant, alive, and joyful, with high information
clarity. Preserve the current Arabic fonts subject to license verification. Select a more
elegant English family through device and readability testing. Arabic and English layouts
share a system but are allowed language-specific typographic tuning.

The preserved Arabic families are **IBM Plex Sans Arabic** and **Noto Kufi Arabic**, with
their current functional roles/weights inventoried before replacement. Phase P05 must
verify licenses/attribution and self-host the approved font files. The Arabic headline label
is provisional until a documented comprehension test in closed beta: at least eight target
Arabic users, at least 80% unaided correct explanation of what the amount includes/excludes,
and no systematic interpretation as bank balance, guaranteed affordability, or money held
by Rushd. Failure requires copy revision and retest before publication.

Do not copy generic dashboard patterns, glass overload, purple-gradient defaults, or
Apple visuals literally. Create Rushd's own signature around money flowing from plan to
reality to availability.

### Motion Lab

Before broad UI replacement, build and device-test isolated prototypes for:

1. Add-button morph and capture sheet.
2. Voice/text becoming structured expense cards.
3. Confirmation flowing into the daily ledger and availability number.
4. Home-to-detail shared-element transition.
5. Plan diff/reconciliation.
6. Goal allocation and Momentum journey.

Record Full, Balanced, and Reduced variants. Select by measured quality, interaction
clarity, and performance—not novelty alone.

Before implementation, freeze a 0–4 Motion Lab rubric for **state-change clarity, Rushd
distinctiveness, delight, continuity/spatial logic, direct-manipulation responsiveness,
bilingual composition, and finish**. The phase implementer and a fresh independent visual
reviewer score every prototype from recordings and live interaction; disagreement is
resolved with cited evidence, never averaged away. A candidate is selectable only when
every dimension is at least 3, distinctiveness and delight are both 4, no accessibility or
behavior gate fails, and all target performance gates pass. P13 beta evidence separately
asks whether signature flows feel beautiful/fun, confusing, dizzying, or slow; a systematic
negative signal reopens P11 even when synthetic traces pass. For at least 12 beta testers,
including at least four Arabic-first and four English-first users, record 1–5 beauty/fun
ratings and per-flow yes/no confusion, dizziness, and perceived-slowness reports. Reopen
P11 when a signature flow's median beauty/fun rating is below 4, or at least 20% of valid
respondents flag the same negative dimension; retain denominators and device/language
breakdowns instead of averaging them away.

### Runtime stack

- CSS, Vue `<Transition>`, transforms/opacity, and explicit motion tokens are the base.
- WAAPI handles small interruptible imperative sequences.
- `motion-v` is lazy-loaded selectively for gestures, stateful sheets, reorder/layout,
  and selected shared elements.
- View Transitions are progressive enhancement for the shell with immediate fallback.
- GSAP is allowed only for one isolated art-directed timeline that cannot be achieved
  cleanly otherwise.
- Rive is allowed only for a lazy-loaded decorative/reactive visual with semantic DOM
  fallback, explicit pause/cleanup, and measured value.
- Canvas/WebGL never owns finance text, controls, charts, or navigation.

Never use `transition: all`, permanent render loops, overlapping engines on the same
property, or animated layout/blur/shadows on hot interaction paths without profiling.

### Quality profiles and gates

- **Full:** spectacular signature choreography and selected shared/layout transitions.
- **Balanced:** same personality and hierarchy with fewer simultaneous/decorative effects.
- **Reduced:** OS preference wins; no spatial/scale/rolling/parallax/confetti/ambient
  motion. State, focus, and accessible announcements remain immediate.

Full is the non-reduced product default and must be engineered to perform on the named
target devices. Balanced is a persistent per-device user choice and may be recommended
after repeated measured frame-budget misses; never infer quality from user agent, core
count, or a device-name list, and never silently downgrade without explaining it. The user
may select Full or Balanced at any time. OS reduced-motion forces Reduced regardless of
the saved choice.

Motion never delays a financial write, consumes input, hides a save error, or changes the
outcome. Every flow must be interruptible and correct under rapid tapping, back navigation,
offline change, reduced motion, and screen-reader use.

Test real installed-PWA behavior on iPhone 15 Pro, iPad Pro M2, Galaxy Tab S9, MacBook Air
M2, plus at least one representative midrange Android device. Playwright WebKit is useful
coverage but not proof of iOS PWA behavior.

## 9. Technical architecture

### Application

- Vue 3 + Vite + strict TypeScript modular monolith.
- Vue Router with the locked hierarchy and secondary routes.
- Feature-oriented modules plus a dependency-light finance domain.
- Command/action registry shared by UI, sync, import, and AI proposals.
- Pinia only if it simplifies UI state after domain/repository boundaries exist; no new
  global mutable finance blob.
- Self-hosted/bundled production assets; no runtime CDN requirement.
- Installable PWA with versioned application shell, safe update flow, and offline fallback.
- URL-addressable Home/Add/Ask/Plan/Insights/Goals and transaction-detail routes survive
  refresh, offline installed launch, authentication interruption, and update. Manifest
  shortcuts expose Add and Ask Rushd where the platform supports them; unsupported
  platforms keep the same in-app path without false native claims.

### Local data

- Preserve `MicroSaveOS_DB` as immutable migration input until verified migration and
  rollback evidence exist.
- Treat every untagged legacy money value as SAR major units. Convert its canonical decimal
  representation to integer halalas exactly when it has at most two decimals. Any value
  with excess precision, invalid sign/range, or ambiguous meaning enters a migration review
  and is not silently rounded. Tag every migrated finance record/book with `SAR` and retain
  the original source value in migration evidence.
- Changing display locale never relabels currency. Version 1 permits changing base currency
  only for an empty finance book or by creating a new book/profile; it does not perform
  silent foreign-exchange conversion of history.
- Reality Check follows the same boundary: explicit foreign-currency input and ambiguous
  currency symbols are clarification-only non-writes. The observation, boundary, and
  signed adjustment always carry the active book's ISO currency.
- Map a legacy unpaid `essential` item to a **provisional reserved commitment** so the old
  arithmetic does not silently increase availability. Mark pool completeness Needs
  Attention until the user reviews it. Other unpaid legacy items become planned-not-
  reserved unless an explicit source field proves otherwise.
- Use a disconnected SQLite-compatible local database for guests. P04 freezes the browser
  persistence/VFS only after physical Safari/iOS/iPadOS/Android/desktop tests. IndexedDB is
  a candidate where supported; Safari/iOS multi-tab requirements must benchmark a supported
  cooperative OPFS option such as `OPFSCoopSyncVFS` and must not assume one VFS works on
  every target. The selected VFS must pass two-tab ownership/locking, crash/reload, quota,
  private-mode, install/update, migration, and rollback tests or use an explicitly tested
  per-platform adapter behind the same repository contract.
- Use a separate local database per signed-in identity.
- All screens read and write local data first. Local transaction + outbox/action receipt
  must be atomic.
- Stable UUIDs, integer minor units, revisions/base revisions, tombstones, idempotent
  mutation IDs, and immutable audit records are mandatory.
- Actual transactions may carry an optional visible `flexibleDefinitionId`. A saved preset
  proposes the link; manual/AI capture may suggest it; review lets the user change or remove
  it. The link affects only flexible-limit monitoring, never availability arithmetic.
  Unmatched activity stays visibly unassigned. Splitting one transaction across multiple
  flexible limits requires an explicit split action.
- Export/import remains available in guest and account modes with versioned schemas and
  validation.

### Cloud and sync

Recommended default, subject to the residency gate:

- Supabase Auth + Postgres.
- Row-level security and server-stamped ownership.
- PowerSync Web SDK for local-first replication.
- Validated writes through transactional Postgres RPC or Supabase Edge Functions; no
  unrestricted generic client upsert.
- Recoverable conflict records for revision/delete conflicts. Never silently drop local
  intent or stall the sync queue indefinitely.
- Cloud export, deletion, account recovery, session/device management, and backup/PITR
  policy before public launch.

Guest data never contacts the cloud. After sign-in the user explicitly chooses Merge this
device data or Keep it local. Merge uses stable IDs and idempotent operations and never
silently replaces existing remote data. Sign-out offers retain or erase local account
cache, then returns to the guest database. Erase is prohibited while unacknowledged outbox
operations or unresolved conflicts exist unless the user first creates a verified export
and confirms an explicit destructive override. Offline/failed-sync sign-out retains the
cache and provides a retry path by default.

### Hosting and provider gate

Use conventional HTTPS PWA hosting; Cloudflare Workers Static Assets is the preferred
starting candidate, with another proven static host acceptable after the same PWA tests.
ChatGPT Sites may host a demo/private beta but is not the sole production system of record
unless consumer auth, PWA/service-worker lifecycle, storage residency, backups, restore,
analytics compatibility, and operational guarantees are verified.

Before cloud provisioning, the founder must decide with qualified advice whether data must
reside in Saudi Arabia. If yes, use a Saudi-region provider such as an appropriate
Firestore design or KSA-hosted Postgres plus self-hosted PowerSync. Keep repository/domain
interfaces provider-aware enough to make that decision without rewriting product logic.

### External requirements

The implementation manager may continue locally with emulators, fake credentials,
provider interfaces, migrations, and tests. It must pause before:

- Creating or billing external accounts.
- Receiving or exposing secrets.
- Choosing a legally significant data region.
- Deploying publicly or changing DNS/domain state.
- Sending real user finance/audio data to an external provider.
- Destructive migration/reset of real data.

## 10. Reliability, privacy, and release gates

### Financial correctness

Use Vitest and property tests for money normalization, availability, reservations,
partial payments/returns, plan idempotency, allocations, cycle settlement, import/export,
Arabic/Western numerals, and date/cycle boundaries. Run mutation testing on extracted
finance logic for release candidates. A test helper not imported by production is not
evidence of production correctness.

### Data and sync resilience

Maintain immutable fixtures for every released local/cloud schema. Test old-tab upgrade,
blocked migrations, quota failures, aborted transactions, corrupt preferences/imports,
two tabs, two devices, delete-versus-edit, expired auth, duplicate/reordered requests,
offline months, retry after restart, and server success after client timeout.

Exactly one visible canonical effect must result from every idempotent operation. A failed
cloud request never becomes a false Saved message.

### Browser, visual, accessibility, and motion

Automated matrix:

- Chromium, Firefox, and WebKit.
- Arabic RTL and English LTR.
- Dark/light, Full/Balanced/Reduced.
- Phone/tablet/laptop, narrow widths, long labels, zoom, empty/error/stale states.
- Stable seeded datasets of 0, 100, 1,000, and performance-test scale records.

Use Playwright screenshots, traces, video on failure, axe after activated UI states,
keyboard tests, and semantic end-state waits. Manual release gates include VoiceOver/
TalkBack, logical RTL focus, dialog focus restore, 200–400% zoom, real PWA install/update,
physical device performance, and motion timing review.

### Performance

Set measured budgets after Phase 0/1 baseline. Release targets include p75 LCP <= 2.5 s,
INP <= 200 ms, and CLS <= 0.1 in consented field telemetry, with no avoidable interaction
long task or animation-triggered layout/paint hotspot in core flows. Test memory/leaks,
battery-sensitive loops, cold/warm offline launch, and realistic ledgers.

### Security and observability

- CSP and secure headers, no runtime secrets, no unsafe raw HTML.
- Dependency/secret/CodeQL scans and import/XSS/prompt-injection/replay tests.
- Authz/RLS tests for every owned entity.
- Privacy-minimized analytics and error telemetry. Never transmit raw expenses, amounts,
  categories, prompts, model outputs, audio, or backup content.
- Version/release/source-map verification, staged rollout, kill switches for AI/sync
  writes, backup/restore drill, incident and rollback playbooks.
- Arabic and English privacy notice, terms, account deletion/export, processor/retention
  inventory, and legal review before external real-data beta.

Every applicable release gate is blocking. There is no aggregate score that can hide a
failed finance, migration, sync, auth, accessibility, or data-loss gate.

## 11. Implementation phases

The machine-readable source is [`implementation/phase-plan.json`](./implementation/phase-plan.json).
The prompts are in [`RUSHD_PHASE_PROMPTS.md`](./RUSHD_PHASE_PROMPTS.md).

### P00 — Protect authority and baseline

Record decisions, hashes, storage inventory, bilingual screenshots/motion recordings,
sanitized legacy fixtures, P0/P1 reproductions, test artifact isolation, and initial
performance/a11y baseline. No product redesign.

### P01 — Immediate corruption containment

Test and minimally fix or visibly block paid-plan mutation, partial plan/import writes,
double settlement, goal double counting, unpaid-obligation surplus, dangerous reset, and
legacy vault disappearance. Every canonical P0/P1 ID receives an executable regression and
a verified fix or visible dogfooding containment plus final owning phase. Ordinary
dogfooding must stop exposing any listed defect silently.

### P02 — Production foundation and mechanical split

Introduce Vite, Vue 3 modules, strict TypeScript for new code, lockfile, local assets,
lint/typecheck/build/CI, router shell, and characterization coverage. Preserve the legacy
database and behavior while moving the 10k-line delivery mechanism into maintainable files.

### P03 — Canonical finance domain and action registry

Implement money/currency/date/cycle types, availability and pacing, planned-versus-actual,
returns/corrections, plan rules, goals/allocations, reality-check adjustment, command
registry, atomic action receipts, undo/reversal, the completeness reducer, disputed-state
arithmetic, timezone/payday effective-date/rebase rules, and property tests.

Before P04, approve a provider-neutral sync/identity ADR covering per-identity databases,
ownership, operation/outbox records, revisions/tombstones, cursor/checkpoint semantics,
conflict rules, guest merge, sign-out cache safety, and provider-specific substitution.

### P04 — Local data v2, migration, and PWA

Implement per-identity local schema, guest repository, outbox, legacy migration with
rollback evidence, versioned import/export, service worker/update flow, installability,
full offline guest operation, URL/manifest entry routes, and the physical-device-tested
browser VFS/per-platform persistence ADR.

### P05 — Design system, locked shell, and Motion Lab

Implement bilingual typography/tokens, responsive locked navigation, accessible shell,
motion profiles, and the six signature prototypes. Select and document the final motion
language through real-browser/device evidence before applying it everywhere.

### P06 — Core product vertical slice

Build dual-path onboarding, Home, Add menu, manual/preset capture, selected-day activity,
full transaction history, notification center, availability breakdown, pacing, and reality
check on the new domain/storage architecture. P06 ships complete fast/manual guest
onboarding and a truthful Smart Setup preview/disabled route; functional AI Smart Setup
arrives after Auth/gateway work in P10.

### P07 — Plan, reconciliation, Insights, and Goals

Build cycle/payday planning, commitments, recurring/flexible templates, preview/apply,
expected-to-actual matching, shortfall handling, accessible insights and scenarios, goals,
allocations, reviews, and recovery flows.

### P08 — Accounts, production sync, and cloud lifecycle

Finalize provider decision, Auth, Postgres/RLS, PowerSync connector/write functions,
guest merge, per-account cache, conflicts, sessions, export/deletion, backup/PITR, sync UI,
and adversarial multi-device tests. The default is Supabase/PowerSync; an authorized
residency amendment may substitute provider-specific infrastructure while preserving the
P03 sync contract. External provisioning may require founder action.

### P09 — AI platform and smart capture

Implement the server gateway, action schemas, context minimization, eval harness, text and
push-to-talk batch capture, correction/matching, receipt/photo capture, proposal preview,
audit/undo, offline degradation, prompt-injection defenses, rate limits, kill switch, and
the frozen OpenAI-versus-production-alternative provider benchmark before provider lock.

### P10 — Ask Rushd and contextual AI

Implement conversation, grounded explanations, onboarding extraction, plan/goal tools,
contextual controls, multi-step orchestration, visible memories/preferences, AI history,
and—only after its gate—spoken/full-duplex voice.

### P11 — Momentum and full motion application

Implement the check-in streak, repair window/token, cycle journey, mastery, weekly mission,
cosmetic rewards, reminder logic, farming/pressure guardrails, and apply the approved motion
system to all critical flows without changing semantics.

### P12 — Extreme QA, security, performance, and release candidate

Run the full property/mutation, migration, sync failure, AI eval, browser/device,
accessibility, visual/motion, performance, privacy/security, backup/restore, and rollback
gates. Fix every blocker and repeat independent review until PASS.

### P13 — Controlled beta and release readiness

Provision approved production services, deploy a controlled beta, verify telemetry
redaction and operational runbooks, collect four weeks of retention/data-quality evidence,
run the pre-registered randomized Momentum pressure/farming gate and any required reduced-
scope rerun, adjust only through tested migrations, and freeze a public release candidate.
Then run the five final independent audits and full gate. Public deployment occurs only
after those
audits pass and the founder authorizes DNS/release; post-deployment verification is required
before the manager completes the goal. Billing, legal approval, and real-data beta also
require founder authority.

## 12. Non-negotiable sequencing rules

1. Protect planning authority and migration evidence before edits.
2. Contain known corruption before a visual rebuild.
3. Define sync ownership/conflicts before finalizing the v2 schema.
4. Build the deterministic command/action layer before AI writes.
5. Prove the motion language in a laboratory before app-wide animation.
6. Build reconciliation and reality check before gamification.
7. Run one write-capable phase at a time.
8. Every phase gets an independent reviewer; financial/sync/migration/AI phases use Sol
   high review.
9. Review failures return to the same phase worker; a new reviewer checks each attempt.
10. A fresh top-level implementation task starts for every new phase.
11. The manager reads checkpoints and targeted evidence, not every worker transcript.
12. No phase silently broadens product scope or revises this contract.

Provider/residency is the sole anticipated architecture amendment. It requires an explicit
human-gate decision, a committed `docs/implementation/PLAN_AMENDMENT_<date>.md`, updated
provider-specific phase paths/criteria, and independent Sol-high review. It may not weaken
the provider-neutral finance, ownership, sync, privacy, or recovery contract.

## 13. Final definition of done

Rushd is done only when:

- The current prototype's legitimate user data can migrate without loss and rollback
  evidence exists.
- Every locked screen and AI surface works in Arabic and English.
- Guest offline and signed-in sync flows converge under the adversarial matrix.
- The availability answer and every mutation are deterministic, explainable, and tested.
- AI evals meet their hard safety/accuracy gates and never write without the command layer.
- Momentum cannot be farmed through spending amount or transaction count.
- Full motion is visually exceptional on target devices; Balanced and Reduced preserve
  product identity and semantics.
- Accessibility, security, privacy, performance, backup/restore, and operational release
  gates all pass.
- Import/export, account deletion, rollback, support diagnostics, and truthful product
  claims are present.
- There are no unexplained working-tree changes, open P0/P1 data risks, or unreviewed
  implementation deviations.
