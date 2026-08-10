# Rushd, in plain language

**Status:** Final founder brief

**Read time:** About 8 minutes

**Canonical implementation plan:** [`RUSHD_MASTER_PLAN_FINAL.md`](./RUSHD_MASTER_PLAN_FINAL.md)

## The product we are building

Rushd is for younger people who manage one main pool of money—students, interns,
allowance users, early earners, and anyone whose budget feels tight or slips away too
easily.

The external beta and public launch are for adults 18+ only. “Younger” means younger
adults; minors and parental-consent/child-data flows are deliberately deferred. Onboarding
uses an age self-attestation and safe exit without collecting a full birth date by default.

It is not limited to Saudi Arabia or Arabic speakers. Arabic and English must both feel
native, polished, and intentionally designed. The first version supports one base
currency and one repeating monthly or payday-anchored money cycle per user; the
architecture must not hard-code Saudi assumptions.

Rushd's central job is to answer:

> After what I have spent, what I still need to pay, and what I deliberately set aside,
> how much is genuinely free for additional spending right now?

The interface can call this **Available for extra spending** in English and use an
equally natural final Arabic label selected during copy testing. The amount must always
have an understandable breakdown and a freshness state.

Rushd's strongest differentiator is not “AI expense entry.” Other apps are beginning to
offer that. The stronger idea is:

> Tell Rushd what you expected and what actually happened. It reconciles the month,
> repairs gaps, and shows exactly what is still free to spend—and why.

## The everyday experience

### Home

Home is the daily loop. It shows:

- The available-for-extra-spending amount and a short explanation of what changed.
- Optional pacing: how much per day would make the remainder last until the next cycle.
- Today’s or the selected day’s actual transactions.
- A primary **Add expense** button.
- A microphone shortcut.
- One attention item or useful insight, not a wall of cards.
- A visible notifications button.
- The user’s Momentum journey and daily check-in entry.
- A prominent **View all transactions** action for full searchable history.

The Add button opens understandable choices:

1. Smart text or voice entry.
2. Manual entry.
3. A saved flexible expense or preset.
4. Receipt, photo, or screenshot capture when the AI capture phase is enabled.

A “flexible expense” is not a strange new kind of transaction. It is a saved planned
pattern or allowance that makes a normal expense faster to record and easier to
monitor. Rushd can suggest the matching flexible limit, but the review screen always lets
the user change or remove that link; the link changes monitoring only, never the core
available amount.

### Permanent navigation

The same five destinations exist on every device:

1. Home
2. Plan
3. Ask Rushd
4. Insights
5. Goals

Phones use bottom navigation. Tablets and laptops may use a rail, sidebar, split panes,
keyboard shortcuts, and hover states, but the mental model does not change. Transactions
is a secondary full-history screen reached from Home, not a permanent tab.

A persistent Profile/Settings button lives in every primary header without becoming a
sixth tab. It owns language, timezone, cycle, notifications, motion, privacy, portability,
account, and device controls.

Each finance book has one active ISO currency. Reality Check always shows and announces
that currency; a different named currency or an ambiguous symbol asks for clarification
and writes nothing. Rushd never converts or silently reinterprets it.

### Plan

Plan is where the user defines the money cycle, starting pool, reserved commitments,
recurring expectations, flexible limits, templates, and buffer. It clearly separates:

- **Reserved commitments:** expected necessities that reduce what is free now.
- **Flexible limits:** guidance or caps that do not get subtracted twice.
- **Extra spending:** the amount left after actual spending and real reservations.
- **Goal allocations:** money the user explicitly marks as set aside; Rushd does not
  hold or move it.

When an expected 80 is finally settled at an actual 65, the 80 reservation is replaced by
the 65 payment and 15 returns to available spending. A partial payment keeps the unpaid
residual reserved. Released variance becomes “savings” only if the user later allocates it
to a goal.

### Ask Rushd

AI is a product-wide capability, not a chatbot hidden in one tab. It appears through:

- A global Ask Rushd control.
- Text and microphone capture on Home.
- Contextual AI actions inside Plan, Insights, Goals, and transaction details.
- A full conversation destination for discussion and complex instructions.

The global control is a quick composer using the current screen as visible, removable
context. Opening the full conversation preserves the same thread, draft, proposals, and
history; there are not two separate assistants.

It can interpret batches across dates and cycles, add and correct expenses, build or
edit plans, work with goals, answer grounded questions, run what-if scenarios, explain
statistics, and help during onboarding.

The model never becomes the financial database. It produces typed, reviewable actions;
Rushd's deterministic engine validates them, shows their effect, commits them, records
an audit receipt, and supports undo. This gives AI broad power without allowing hidden
or mathematically invented changes.

### Insights and Goals

Insights explains behavior rather than dumping charts. It includes flexible-limit
monitoring, plan-versus-actual comparisons, spending pace, category and merchant views,
cycle summaries, and deterministic “Can I spend X?” scenarios.

Goals shows explicitly allocated and tracked-but-not-allocated amounts. Insights and goal
suggestions inherit the headline's completeness state: uncertain records show assumptions
and point to Reality Check; unavailable data never produces affirmative spending or
contribution advice. Rushd never claims to custody, protect, or transfer real money.

## The missing feature research found

The most important new idea is a **reality check**. Without bank linking, one forgotten
purchase can make the headline amount wrong forever. In roughly 10–15 seconds, the user
can say how much is actually left in the pool. Rushd explains the difference, helps
recover remembered expenses, or records a clearly labeled reconciliation adjustment.
The observed pool is refreshed immediately. The headline becomes Current only when all
pool-completeness conditions are satisfied; otherwise it stays Needs Attention and names
what remains unresolved, while category insights stay honestly incomplete.

Other additions now included in the plan:

- Payday-anchored money cycles, not only calendar months.
- A visible shortfall state such as “Short by 120,” never a silently clamped zero.
- Separate “money left” and optional “pace to make it last” answers.
- Quick recovery after missing several days instead of demanding a perfect backfill.
- Receipt/photo/screenshot capture after text and voice capture are reliable.
- Learned merchant/category defaults that the user can see, correct, and forget.
- URL-addressable PWA routes plus tested Add/Ask manifest shortcuts where supported;
  refresh, offline launch, authentication interruption, and update preserve the intended
  destination. Native-only widgets and richer shortcuts wait for a native wrapper.

Rushd deliberately does not become a bank-aggregation, investing, debt-optimization,
household-accounting, or multi-currency product in version 1.

## Onboarding

Onboarding has two speeds and uses AI immediately:

- **Fast start:** choose language, currency, cycle/payday, and current pool boundary;
  record one expense and see the first useful answer.
- **Smart setup:** talk or type naturally about income timing, commitments, recurring
  spending, flexible habits, and goals; Rushd organizes the description into one review
  screen.

Sign-in is offered as the way to synchronize devices, not as a wall before trying the
core app. Guest use stays offline-capable. AI requires connectivity and a signed-in
account. Guest data can later be deliberately merged into an account without silently
overwriting existing cloud data.

Timezone and week start are auto-detected and visibly confirmed before the first financial
calculation. Smart Setup is an online signed-in path; guests receive a field-equivalent
guided manual setup and can unlock Smart Setup later without losing progress.

## Motivation: Momentum

The old “1 unit saved = XP” system is removed because users will optimize whatever the
app scores. Rushd should still have real stakes, streaks, gorgeous graphics, rewards,
and daily pull—just tied to record completeness rather than spending less or fabricating
transactions.

A day counts when the user closes it by reviewing recorded spending, resolving due
items, or confirming that nothing else needs to be added. It earns one **check-in mark**
for that date; transaction count, amount, underspending, and wealth never create extra
progress.

“Closed” means reviewed as of a visible local time. If spending is added later, the mark is
kept but labeled for a quick re-review; it never duplicates or pretends the day could not
change.

The launch system includes:

- A visible daily check-in streak.
- A 48-hour repair window requiring a real catch-up.
- One repair token earned through a completed weekly review.
- A private animated cycle journey that grows with completed days.
- Permanent mastery cards for useful behaviors such as an honest correction, realistic
  plan, return after a gap, and completed cycle review.
- One user-chosen weekly mission.
- Cosmetic rewards such as scenes, themes, frames, transition styles, and summary cards.
- Opt-in reminders, a hide-streak control, and recovery language after a break.

Push stays off until the user enables a reminder. Routine and streak-risk reminders are
separate choices, use generic lock-screen text, and open a focused resolution screen.

There are no public leaderboards, random loot, paid streak protection, artificial
scarcity, or rewards for transaction farming. A missed streak has a consequence, but it
does not erase the user’s history, collectibles, or longest streak.

## Design and extreme motion

The ambition remains genuinely extreme: screen transitions, capture, plan changes,
available-amount recomputation, goal allocation, and Momentum progression should feel
fluid, surprising, joyful, and unusually premium.

The implementation begins with a dedicated **Motion Lab** rather than scattering effects
throughout unfinished screens. It prototypes and device-tests the signature moments
before the full redesign:

1. Add-button morph into capture.
2. Voice/text becoming reviewable expense cards.
3. Save confirmation flowing into the Home amount and day ledger.
4. Shared-element navigation between Home and transaction detail.
5. Plan-diff/reconciliation choreography.
6. Goal allocation and Momentum journey progression.

CSS, Vue transitions, and the Web Animations API form the lightweight foundation.
`motion-v` is used selectively for gestures and layout choreography. Native View
Transitions are a progressive enhancement. GSAP or Rive may be used only for an isolated
signature sequence when they demonstrably improve the result.

There are Full, Balanced, and Reduced experiences. Full is allowed to be spectacular;
Balanced keeps the same product personality with fewer simultaneous effects; operating-
system reduced-motion always wins. All financial outcomes and controls remain identical
with motion disabled. Performance is proven on real iPhone, iPad, Galaxy, and Mac targets,
not inferred from device names.

Full is the normal non-reduced default. Balanced is a remembered per-device option and can
be recommended when Rushd measures repeated frame-budget misses; Rushd does not guess from
the device name or silently downgrade the experience.

## Accounts, offline use, and publishing

The recommended production architecture is:

- Vue 3 + Vite + strict TypeScript PWA.
- A deterministic finance domain and command/action layer.
- A local SQLite-compatible database using a physical-device-tested browser VFS; IndexedDB
  or cooperative OPFS is selected per the Safari/iOS multi-tab and recovery ADR, not assumed.
- Supabase Auth and Postgres as the signed-in system of record.
- PowerSync for local-first multi-device synchronization.
- Transactional server functions for validated writes and an authenticated provider
  gateway; OpenAI is the provisional first candidate and must win the frozen benchmark.
- Conventional PWA hosting, initially Cloudflare Workers Static Assets or an equivalent
  proven host.

ChatGPT Sites is useful for a prototype or controlled beta, but current documentation
does not establish the PWA lifecycle, general consumer authentication, storage region,
backup/restore, SLA, and offline-sync guarantees needed for Rushd's only production data
store.

If legal review requires Saudi-resident financial data, managed Supabase cannot be chosen
blindly: the provider decision must switch to a Saudi-region option or KSA-hosted Postgres
with self-hosted sync. This is a provisioning decision, not a reason to stall the local
architecture.

Import and export remain available for guests and signed-in users. No secret, provider
credential, deployment, or real financial record is committed to the repository.

## How implementation will run

One Sol-high manager task owns the full outcome. It does not implement product code. It
starts every phase in a fresh Sol-high implementation task, waits for a structured
checkpoint, commissions an independent review, sends exact corrections when needed, and
then starts the next fresh task automatically.

Only one writer runs at a time. Terra-high supports browser testing and trace work;
Luna-medium handles mechanical evidence; Sol-medium reviews simpler phases; Sol-high
reviews financial, sync, AI, and migration work. Sol-xhigh is reserved for repeated hard
failures or conflicting evidence.

No phase passes because an agent says “done.” It passes only when its acceptance criteria,
tests, browser evidence, migration/data checks, and independent review are all green.
External account creation, credentials, legal decisions, real deployment, or destructive
data operations are the only expected reasons to pause for the founder.

That manager protocol, every phase prompt, and the machine-readable phase plan are already
prepared beside the final master plan.
