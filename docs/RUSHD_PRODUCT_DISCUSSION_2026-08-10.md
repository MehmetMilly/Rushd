# Rushd Product Discussion — Research-Backed Answers

**Date:** 10 August 2026

**Status:** Discussion proposal; not yet merged into the master plan

**Founder feedback source:** `RUSHD_FOUNDER_FEEDBACK_2026-08-10.md`

## Bottom line

The master plan does not need to be thrown away. Its work on financial correctness, safe migrations, architecture, accessibility, testing, and staged implementation is valuable. It does need a substantial product correction in six areas:

1. Rushd should target a global younger audience with excellent Arabic **and** English, not a Saudi-only audience.
2. AI should be a first-class interaction layer across the product, not perceived as an isolated capture feature or a distant add-on.
3. Account-based cloud sync should be in the core architecture and launch scope while the app remains usable offline.
4. Gamification should be rebuilt into a genuinely compelling daily system, including meaningful streaks and recoverability—not reduced to a passive activity indicator.
5. Statistics/Insights, templates, flexible-item planning, and flexible-item monitoring need explicit homes in the information architecture.
6. Premium motion, onboarding, performance, reliability, and extreme QA need to be visible product pillars rather than details buried in implementation sections.

The right target is:

> **A global, bilingual, AI-native spending companion for younger people managing one main monthly pool of money—fast and motivating every day, synchronized across devices, fully useful offline for non-cloud features, and reliable enough to trust with financial records.**

“Powerful” and “safe” are not opposites. The assistant can control almost everything in Rushd while the application—not the model—still owns arithmetic, permissions, exact records, and durable writes.

---

## First, what the master plan actually did cover

The full plan discussed several things that the shorter founder review failed to surface:

- **Onboarding:** Section 5 contains first-launch, mid-month, progressive setup, and AI-assisted routine setup flows.
- **Animations and interaction:** Sections 8 and 9 define navigation transitions, sheet motion, value recalculation, reduced motion, performance, and a visual system.
- **Performance and reliability:** Sections 13, 14, and 16 contain financial invariants, atomic operations, PWA/offline behavior, performance budgets, failure injection, browser testing, and extreme QA.
- **Broad AI control:** Section 6 includes expenses, plans, flexible limits, goals, onboarding, statistics, conversation, and voice—not only expense capture.

The problem is partly the plan's organization and partly the summary. These priorities were buried, and some recommendations—especially local-only positioning, delayed sync, subdued retention, and feature-flagged AI breadth—do conflict with the founder's intent.

---

## 1. Audience, languages, and the central financial answer

### Revised audience

The audience should be defined by financial behavior, not nationality:

- Younger people with a tight budget or overspending problem.
- People who mostly manage one monthly pool of money.
- Students, interns, allowance users, scholarship recipients, and early earners are the strongest examples.
- People who want clarity without the complexity of full accounting or mandatory bank linking.

Rushd can be globally available without becoming a multi-account finance suite. The launch model can still be one base currency, one main monthly pool, and one user's plan. Country, currency, numeral format, first day of week, time zone, and language become account/profile preferences rather than Saudi assumptions.

Arabic and English should be equal-quality product languages:

- Arabic RTL is designed natively.
- English LTR receives its own copy review, typography, layout testing, and interaction polish.
- Neither language is a mechanically mirrored afterthought.
- The existing Arabic font pair remains. English typography can change after real paired-screen testing.

### Revised central answer

The founder's intended answer is clearer than “available according to your plan.” It is:

> **How much money is genuinely available for extra, non-essential spending after necessary spending and known commitments are accounted for?**

Recommended user-facing labels:

- English: **Available for extra spending**
- Arabic: **المتاح للصرف الإضافي**
- Supporting line: **After necessities and commitments in your plan / بعد الضروريات والالتزامات في خطتك**

The word “estimated” appears only when important data is missing. The detailed calculation remains available behind “How was this calculated?”; the main screen should not read like a financial disclaimer.

This is a meaningful change to the plan's product language, not to the need for correct calculation.

---

## 2. AI: broad power without making it a dangerous black box

### The plan's AI was broader than it sounded

The full plan already envisioned AI for expenses, plans, flexible limits, goals, onboarding, statistics, conversation, and voice. What made it feel weak was:

- It was represented in navigation as a “capture sheet.”
- Broader control was placed late in the roadmap.
- Public 1.0 feature-flagged too much of it.
- Privacy friction was designed around a local-only positioning promise the founder no longer wants.

These should change.

### Recommended model: AI is both global and contextual

Rushd's assistant should exist in four forms that all share one conversation/action system:

1. **Global Ask Rushd control:** available from every screen through a persistent action and keyboard shortcut.
2. **Direct Home capture:** a visible “Add expense” control and microphone on Home for the most common task.
3. **Contextual AI:** “Ask about this,” “Change with Rushd,” or microphone actions inside Plan, Insights, Goals, and transaction details.
4. **Full conversation view:** a larger assistant panel for ongoing financial discussion, multi-step setup, or complex commands.

A user could say:

> “Add Uber for 28 yesterday, lower my haircut budget to 150 next month, and tell me if I can spend 200 on shoes this week.”

Rushd should organize that into three understandable parts—one transaction, one plan change, and one scenario—then let the user review the consequences efficiently.

### Power should determine the confirmation, not whether AI is allowed

Recommended authority levels:

| Action | Behavior |
| --- | --- |
| Explain, search, filter, navigate, open a screen | Execute immediately; no confirmation |
| Fill a draft or interpret speech/text | Show the editable result immediately |
| One explicit, reversible expense or small edit | Compact preview and one clear confirmation tap |
| Batch, multi-month, plan, budget, flexible-limit, or goal change | Grouped before/after preview and one explicit confirmation |
| Delete history, replace/import data, reset, account/security changes | Dedicated manual confirmation; AI can prepare or navigate but not silently commit |

This is not a “weak AI” model. It gives AI broad control while keeping confirmations proportional. Current structured-output systems can reliably conform to schemas, but schema correctness does not prove that the values or intended action are correct. Official guidance also supports tool-specific human approval rather than treating every tool identically ([OpenAI Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/), [OpenAI human-in-the-loop tools](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)).

### Privacy friction should be reduced honestly

The revised promise should be:

- Guests can use the non-AI core locally without an account.
- Signed-in users receive AI and synchronization.
- AI/cloud processing is explained clearly once during account/AI setup, with permanent controls in Settings.
- Rushd does not interrupt every ordinary AI request with a new consent sheet.
- Backend tools enforce account authorization and retrieve only the records needed for the request.
- No model has arbitrary database or cross-user access.

“Local-first privacy” should disappear from positioning. Offline capability, guest mode, authorization, encryption, deletion/export, and responsible data handling remain engineering requirements because cloud financial records demand them.

---

## 3. Gamification: keep the pressure, make it serve the real behavior

### What the research says

The original plan overcorrected by removing meaningful streak pressure. Research across seven studies found that displaying an intact streak increases subsequent engagement, while highlighting a broken streak lowers it; allowing streak repair reduces the negative effect of the break ([Journal of Consumer Research](https://academic.oup.com/jcr/article/49/6/1095/6623414)). A natural experiment after GitHub removed visible streak counters found fewer long streaks and less one-contribution/weekend activity, showing both that streaks work and that they can push low-value behavior ([Moldon, Strohmaier, and Wachs](https://arxiv.org/abs/2006.02371)).

The lesson is not “streaks are bad.” It is:

> **A streak will optimize whatever behavior earns it, so Rushd must reward financial honesty—not app opens, spending less at any cost, or creating extra transactions.**

Gamification research in financial contexts also supports using progression, challenges, goals, and rewards to make financial activity more engaging, while goal-setting evidence suggests that concrete saving goals can improve saving behavior ([OECD digital financial education review](https://www.oecd.org/content/dam/oecd/en/publications/reports/2021/01/digital-delivery-of-financial-education_e9c6655c/d02549e7-en.pdf), [Goal Setting and Saving in the FinTech Era](https://onlinelibrary.wiley.com/doi/full/10.1111/jofi.13339)).

### Recommended system: Rushd Momentum

The current XP system should be rebuilt, not merely deleted. A working name is **Rushd Momentum / زخم رُشد**; naming can change later.

#### Layer 1: a real daily streak

A day counts when the user reaches a truthful daily state by doing one of these:

- Records real spending and resolves any scheduled item that needs an answer.
- Confirms that there was no spending that day.
- Completes a short catch-up review for that day.

Opening the app does not count. Ten tiny entries do not count more than one honest completed day.

The streak should have stakes:

- A visible end-of-day deadline.
- A direct “Your 12-day streak needs today's check-in” reminder.
- A stronger final reminder if the user explicitly enabled streak notifications.
- A clear celebration when the day becomes complete.

#### Layer 2: recovery rather than fake forgiveness

- A broken day remains repairable for a short period, such as 24–48 hours.
- Repair requires reviewing what actually happened, not tapping a free pass.
- A limited Streak Shield can be earned through real behaviors such as completing a weekly review.
- Repaired days remain visibly marked in history.
- If the streak is truly lost, longest streak, monthly progress, levels, and earned collectibles remain. One loss should hurt, but not erase the user's entire identity in the app.

This keeps loss aversion and urgency while reducing the “I lost everything, so I quit” effect identified in streak research.

#### Layer 3: XP/progression based on meaningful actions

XP or Momentum Points can remain, but earning must be capped by behavior and time period:

- Daily review completed: once per day.
- Weekly review completed: once per week.
- A planned item reconciled honestly.
- A realistic plan improved after actual evidence.
- A goal allocation confirmed.
- A backup/restore drill completed.
- A lapse successfully recovered.

No XP for:

- The amount of money spent or not spent.
- Splitting one transaction into many.
- Opening screens repeatedly.
- Creating and deleting fake records.

#### Layer 4: missions, mastery, and rewards

- Adaptive weekly missions: “Review 5 days,” “resolve two scheduled items,” or “check your dining limit before the weekend.”
- Long-term mastery tracks: Accurate Tracker, Realistic Planner, Consistent Reviewer, Goal Builder.
- Achievements for meaningful firsts and comebacks.
- Cosmetic rewards: themes, motion flourishes, profile frames, alternate app icons, collectible month summaries, and assistant personality accents.
- Seasonal/monthly journeys that reset short-term freshness while permanent mastery remains.

The app can be strongly compelling without turning necessary overspending into a moral failure. Research on gamification misuse shows that users can become fixated on the score rather than the underlying goal; this is why Rushd's rewards must be tied to record quality and decisions ([ACM Learning at Scale study](https://arxiv.org/abs/2203.16175)).

### What to measure

Do not judge this system mainly by raw opens. Measure:

- Percentage of days with complete, truthful records.
- Return after a broken streak.
- Missing-item and later-correction rates.
- Weekly review completion.
- Whether users create low-value/fake actions to protect progress.
- Notification opt-out and “this feels stressful” feedback.

The founder's intended outcome is positive real-life behavior. These metrics tell us whether the retention system is actually producing it.

---

## 4. What “underspend is not automatically savings” actually means

The idea was explained badly. The simple version is:

> If Rushd expected something to cost 80 and it actually cost 65, the extra 15 becomes available again. But it is not necessarily “saved money”—the user may spend it tomorrow.

Example:

```text
Haircut reserved in plan       80
Actual haircut                 65
Returned to extra-spend room   15
```

Recommended UX:

- Show **15 less than expected**.
- Immediately increase **Available for extra spending** by 15 if the rest of the calculation is complete.
- Offer an optional action: **Move this 15 toward a goal**.
- Only after that allocation call it saved toward that goal.

This should be automatic and obvious, not wrapped in warnings. The distinction only prevents Rushd from claiming that money was saved when it was merely not spent on this one item.

---

## 5. The screens, with concrete contents

### Recommended phone navigation

The current plan should change to:

1. **Home**
2. **Transactions**
3. **Ask Rushd** — central global action, not merely “capture”
4. **Plan**
5. **Insights**

Goals remain easy to reach from Home and Plan. On tablets/laptops, Goals becomes its own sidebar destination because there is enough space. Settings stays under the account/profile control.

This order reflects frequency:

- Home, Transactions, and Ask Rushd are daily.
- Plan and Insights are weekly/monthly.
- Goal administration is important but less frequent than checking statistics.

### Home: exactly what appears

```text
[Rushd]                         [sync state] [streak] [account]

Available for extra spending
1,158
After necessities and commitments in your plan
[monthly pool ─ paid ─ reserved ─ extra spending]
[See calculation]

[+ Add expense]          [microphone: Tell Rushd]

Today
- Coffee, 18 — recorded
- Internet bill — Is this paid, delayed, or cancelled?

Flexible spending
- Dining: 140 of 220 used
- Rides: 3 of 8 uses

Your momentum
- 12-day streak · today's check-in incomplete

One useful insight
- Weekend dining is 22% higher this month [See Insights]
```

Home remains the fastest place to add a transaction. Ask Rushd is also available, but the user never has to open a chat just to add one expense.

### Transactions: what the plan called “Activity”

“Activity” meant the complete human-readable list of money records. **Transactions** is clearer.

It contains:

- Every paid, planned, partially paid, cancelled, or corrected item grouped by day.
- Search and category/date/status filters.
- Transaction detail and edit history.
- Bulk actions.
- Links back to the routine/template that created a planned item.

A **refund** is simply money returned after an earlier payment—for example a returned product or cancelled ride. It is a detail action, not a navigation concept that needs prominence.

“Review inbox” should be removed as jargon. Use **Needs your answer** or **To confirm**. Examples:

- “This internet bill was planned for yesterday. Was it paid, delayed, or cancelled?”
- “Rushd heard 70 or 17. Which amount is right?”
- “This offline plan edit conflicts with a newer edit from your iPad. Choose the correct version.”

These items can appear contextually on Home and in Transactions; there does not need to be a mysterious separate inbox.

### Ask Rushd: a global capability, not an expense-only tab

The central control opens the assistant over the current screen. It understands current context but can act across the whole product.

- Tap: open text/voice conversation.
- Hold: start voice immediately, with a visible recording state.
- Laptop shortcut: `⌘K` or `/` for command/conversation; `⌘N` for quick expense.
- Contextual microphone/action buttons remain available inside Home, Plan, Insights, Goals, and detail screens.

The assistant conversation can expand full-screen when needed. On tablets/laptops it can become a persistent right-side panel while the relevant plan, statistics, or transaction detail remains visible.

### Plan: templates and flexible items live here

Plan contains:

1. Monthly pool and cycle/payday.
2. Necessary commitments.
3. Workday/off-day/everyday routines.
4. Monthly recurring items.
5. Flexible items and their limits—for example “haircut: twice/month, around 80 each” or “dining: 300/month.”
6. Advanced plan profiles/templates such as University, Summer, or Internship.
7. A preview of what applying a changed plan will do.

Normal UI can say **routine**, **monthly commitment**, and **flexible spending limit**. “Template definition” and “profile assignment” remain internal terms.

### Where flexible-item monitoring belongs

Flexible items need the same data shown at three levels:

- **Home:** only items close to a limit or immediately relevant.
- **Plan:** current used/remaining amount beside the definition, with an Edit limit action.
- **Insights:** full history, uses, average amount, trend, comparisons, and AI explanation.

This preserves the founder's original Statistics monitoring idea while keeping planning and editing in Plan.

### Insights: Statistics did not disappear

Insights is the redesigned Statistics screen. It should include:

- Monthly overview and extra-spending calculation.
- Category breakdown.
- Essential versus non-essential spending.
- Expected versus actual differences.
- Flexible-item usage and trends.
- Weekly/monthly comparisons.
- Goal progress.
- Forecast/scenarios with visible assumptions.
- “Ask Rushd about this” on every meaningful module.

Charts should appear when the data supports them. “Do not show fake/empty charts” should not be misread as “remove statistics.”

### Tablet and laptop layout

Do not stretch the phone UI into giant cards.

- **Phone:** bottom navigation, one main column, bottom sheets, touch-first controls.
- **Tablet:** collapsible sidebar, list/detail split, assistant as an optional side panel, support for touch/trackpad/keyboard.
- **Laptop:** persistent sidebar, centered main work area, optional right assistant/inspector, hover states, keyboard shortcuts, resizable columns, and real browser history/navigation.

The visual language stays shared, but information density and input behavior adapt to the device. Apple's current design guidance likewise emphasizes consistency that adapts across window sizes and input methods, and even recommends different motion emphasis for direct touch versus trackpad input ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines), [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion)).

---

## 6. Onboarding: it was in the plan, but it needs a stronger version

Onboarding is not missing from the master plan; it was missing from the summary. The plan's “first useful action before a setup marathon” principle is good. However, the founder is right that Rushd also needs enough information to work well immediately.

Apple's onboarding guidance recommends a fast, optional, interactive flow, teaching through real actions and postponing nonessential setup rather than asking users to memorize the product ([Apple onboarding guidance](https://developer.apple.com/design/human-interface-guidelines/onboarding)). For Rushd, AI allows a user to provide rich setup without filling ten separate forms.

### Recommended dual-path onboarding

#### Step 1: language, region, and account choice

- Choose Arabic or English; confirm currency/country/time zone defaults.
- **Sign in / Create account:** unlocks cloud sync and AI setup.
- **Continue locally:** full manual non-AI core, with sign-in available later.

The local path is honest, not hidden. The signed-in path is recommended because it provides the intended Rushd experience.

#### Step 2: “Tell Rushd about your month”

The signed-in user can type or speak freely:

> “I get 2,500 around the first. Rent is 900, phone is 100, I spend about 25 on lunch on workdays, Uber maybe eight times a month, and I want 300 left for going out.”

Rushd extracts:

- Monthly pool and cycle.
- Necessary commitments.
- Routines.
- Flexible items and limits.
- Unclear/missing information.

The manual local path offers the same groups as a short structured flow.

#### Step 3: one review, not many forms

Show a single editable setup summary. Ask follow-up questions only for meaningful ambiguity. The user can remove any inferred item before saving.

#### Step 4: establish today's truthful starting point

- Start from the full month and review earlier spending.
- Start from the amount remaining today.
- Start tracking with an estimated/incomplete result.

#### Step 5: add or import the first real transaction

Use text, voice, or manual input. Then land on a populated Home screen that visibly demonstrates the value of the setup.

### Two speeds

- **Quick start:** about 60–90 seconds; monthly pool, key commitments, current boundary, first transaction.
- **Complete setup:** about 3–5 minutes; routines, flexible limits, goal, notification/streak preference.

Users may skip anything nonessential. The completed setup remains editable and the AI can continue it later. This is more powerful than the current plan's narrow first-expense flow without restoring the prototype's long modal.

---

## 7. Visual direction and animation

### What “instrument-like surfaces” was supposed to mean

It was design language for surfaces that behave like clear measuring tools:

- Precise aligned numbers.
- A visible relationship between total money, commitments, spending, and what remains.
- Fine structure and intentional hierarchy rather than decorative cards.
- State changes that visually show where money moved.

It did **not** mean making the app look like a physical calculator or dashboard full of gauges. The phrase is too vague and should be replaced in the plan with concrete screen prototypes and motion examples.

### Recommended visual signature

Keep **The Rushd Measure** as one distinctive system, but define it concretely:

> A responsive “money runway” that shows the monthly pool flowing through necessities, paid spending, flexible room, and the amount available for extra spending.

On phones it is a compact, tappable segmented rail below the main amount. On larger screens it can expand into an interactive month map with exact labels and drill-down. It appears only where a real financial relationship exists.

The rest of the interface should remain quiet enough for that signature to matter:

- Dark and light themes.
- Existing Arabic fonts.
- A carefully paired English family.
- Indigo structure and orange action can remain starting points, but final colors require real screen comparisons.
- Flat/tonal surfaces, exact spacing, strong typography, excellent states, and restrained blur.
- No generic purple-neon AI styling or decorative financial charts.

### “Crazy animations” should mean ambitious choreography

The best signature motion proposal is the capture-to-consequence sequence:

1. The microphone reacts to the user's voice.
2. The transcript resolves into structured expense/plan chips.
3. Those chips become editable proposal cards.
4. On confirmation, the cards travel into the correct day/section.
5. The extra-spending amount and money runway rebalance together.
6. The streak/progress state completes only after the durable save succeeds.

Other high-value motion moments:

- Shared-element transitions from a Home item to its detail.
- Plan before/after diff morphing into the applied state.
- Goal allocation visibly moving from unallocated money to a goal.
- Charts drawing on first reveal and responding smoothly to period changes.
- Gesture-driven sheets that track the finger and can be interrupted.
- Rich month-close and achievement moments.
- Subtle pointer/keyboard states on laptops and stronger tactile response on touch devices.

Apple's own motion guidance emphasizes that beautiful motion conveys status and causality, should be brief for frequent actions, cancellable, and adapted to the user's input/accessibility preferences—not that motion should be absent ([Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion)).

### Motion quality gates

- Target smooth 60fps where the display/device allows it; animate transform and opacity when possible because layout/paint-heavy animation is more likely to stutter ([web.dev animation performance](https://web.dev/articles/animations-overview)).
- Frequent entry never waits for a flourish to finish.
- No animation claims success before the write is durable.
- Full, Balanced, and Reduced/System motion modes are acceptable; `prefers-reduced-motion` must disable nonessential spatial movement because interaction-triggered animation can cause real discomfort ([W3C WCAG motion guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)).
- Test motion recordings on real low-end and high-refresh devices, not only desktop emulation.

Premium animation and strong performance are the same quality problem. Stuttering “extreme” motion is less premium than a simpler sequence that never drops context.

---

## 8. Cloud sync and offline behavior

### Revised product modes

| Mode | Data | AI | Offline |
| --- | --- | --- | --- |
| Guest/local | Stored on this device; export/import available | No | Full non-cloud core |
| Signed-in | Local working copy synchronized to the user's account | Yes | Core reads/writes continue; sync resumes online |

When a guest signs in, Rushd must preview and safely merge/upload local data. Signing out should ask whether to keep an offline copy on that device or remove it after confirmed synchronization.

### Recommended sync architecture

The app should save immediately to a local database, append a unique operation to a sync outbox, and update the UI. When online, the server authenticates, validates, deduplicates, stores, and distributes those operations to the user's other devices.

```text
User action
  → local atomic save
  → local action/outbox ID
  → immediate UI update
  → authenticated server validation
  → server acknowledgement/version
  → other devices receive and apply
```

Do not use naive whole-document “last write wins” for financial history. Firestore's own offline documentation, for example, states that concurrent changes to the same document use last-write-wins; Rushd therefore needs domain-specific records, revisions, idempotency IDs, tombstones, and conflict rules rather than blindly trusting a backend default ([Firestore offline behavior](https://firebase.google.com/docs/firestore/manage-data/enable-offline)).

Recommended conflict rules:

- Payments, refunds, reversals, and action history are append-only events.
- Repeated operations with the same ID have one effect.
- Plans and goals are revisioned; incompatible concurrent edits produce a before/after conflict instead of silent overwrite.
- Deletes synchronize as tombstones until every device has observed them.
- The UI shows **Saved on device**, **Syncing**, **Synced**, or **Needs attention**.
- AI/cloud actions and local actions use the same command/action log so they cannot duplicate each other.

### Important PWA limitation

Offline work is realistic. Instant hidden synchronization while the installed PWA is closed is not equally reliable across browsers. The Background Sync API has limited browser availability, so Rushd should always synchronize on app launch, foreground, reconnect, and normal online activity; background synchronization is an enhancement, not the only path ([MDN Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)).

This still gives the user what matters: every device converges when it next has connectivity and the app has a chance to run.

---

## 9. Performance, reliability, and extreme QA

These were deeply covered in the master plan, but cloud sync adds a major new test surface. They should be elevated into founder-visible acceptance gates.

### Performance targets

- Immediate local visual feedback for tap/type/drag actions; never wait for sync or AI before preserving input.
- Core Web Vitals “good” at the 75th percentile: LCP ≤ 2.5 seconds, INP ≤ 200 ms, CLS ≤ 0.1 ([web.dev thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)).
- 60fps target for core motion on supported devices; no repeated main-thread tasks over 50 ms in normal flows.
- Home, Transactions, and Plan remain responsive with at least 10,000 transactions.
- Cold offline launch opens the last complete local state.
- AI/voice shows progressive states and never blocks manual use.
- Large-screen layouts are useful rather than merely stretched.

### Reliability guarantees

- Zero duplicate financial effect from retry, double tap, reconnect, or replay.
- Every accepted action is complete or has zero canonical effect—never “half saved.”
- Paid history cannot be rewritten by plan changes.
- Imports, plan applications, month close, guest-to-account migration, and sync merges are atomic or recoverable.
- Every amount on Home, Insights, and AI explanation comes from one versioned financial engine.
- Drafts survive keyboard close, navigation, network failure, AI failure, and app backgrounding.
- Cloud outage does not block guest/local core or signed-in offline work.

### Extreme QA matrix

The revised plan should retain and expand:

- Unit tests for all money/date/plan/goal rules.
- Property-based tests for invariants and generated edge cases.
- Migration fixtures for every historical database shape.
- Multi-device sync simulation with delay, duplication, reordering, conflicts, clock skew, logout, expired sessions, and server rejection.
- Failure injection after every durable step.
- End-to-end tests in Chromium, Firefox, and WebKit.
- Real iPhone/iPad/Safari PWA, Android/Chrome, and laptop browser testing.
- Arabic RTL and English LTR; dark/light; touch, pointer, keyboard, screen reader, zoom, and reduced motion.
- AI evaluation across Arabic dialects, English, code-switching, numbers, dates, ambiguity, voice noise, batches, and adversarial requests.
- Visual screenshot and motion regression review.
- Performance tests on realistic lower-end mobile hardware.
- Restore, account recovery, guest-to-account merge, and multi-device disaster drills.

The PWA choice is reasonable, but cross-browser platform differences are real and must be tested. Current PWA guidance notes that installation and background capabilities vary across iOS/iPadOS, Android, and desktop browsers ([web.dev PWA platform overview](https://web.dev/learn/pwa/progressive-web-apps)).

---

## 10. How the roadmap must change later

After the discussion is approved, the master plan revision should make these structural changes:

1. Replace Saudi-only positioning with a global younger one-pool audience and equal Arabic/English quality.
2. Replace SAR hard-coding with one configurable base currency per account/guest profile.
3. Rename the core answer to “Available for extra spending” and update the explanation model.
4. Replace local-only privacy positioning with guest-local plus signed-in synchronized modes.
5. Add authentication, account recovery, cloud data model, authorization, sync engine, conflict rules, and guest migration to the architecture.
6. Move sync from optional Phase 11 into the core foundation before public release.
7. Make full AI breadth a public-product goal, with proportional confirmations and global/contextual entry points.
8. Replace the mobile IA with Home / Transactions / Ask Rushd / Plan / Insights; place Goals contextually and in larger-screen navigation.
9. Make onboarding dual-path and AI-powered for signed-in users.
10. Replace the passive Rhythm concept with the stronger streak/progression/missions/recovery system.
11. Define flexible-item planning and monitoring across Home, Plan, and Insights.
12. Replace vague visual language with approved component galleries, real screen prototypes, and signature motion prototypes.
13. Add measurable performance, sync, motion, cross-device, and extreme-QA gates.

The safe sequencing rule still holds: AI and sync should be designed into the architecture early, but durable AI actions must use the same correct command/financial core as manual actions. That is how Rushd becomes more powerful without becoming fragile.

---

## Recommended decisions for the founder

These are the proposed defaults to accept or change next:

1. **Audience:** Global younger users with one monthly pool; Arabic and English receive equal product quality; one base currency per profile/account.
2. **Core answer:** “Available for extra spending / المتاح للصرف الإضافي,” after necessities and commitments.
3. **Phone navigation:** Home / Transactions / Ask Rushd / Plan / Insights; Goals accessible from Home/Plan and top-level on larger screens.
4. **AI:** Global and contextual across the app; broad read/write proposals; confirmations proportional to impact; account required.
5. **Gamification:** Daily truth streak + short repair window + earned shield + behavior-capped XP/progression + missions/collectibles/mastery.
6. **Onboarding:** Sign-in/AI-sync or local/manual path; natural-language whole-month setup; one review; truthful starting boundary; first transaction.
7. **Publishing:** Installable, offline-capable PWA with deliberate phone/tablet/laptop layouts; no native wrapper required now.
8. **Sync:** Launch requirement; immediate local writes, authenticated operation sync, explicit conflict handling, visible sync state.
9. **Visual/motion:** Keep The Rushd Measure as a concrete money-runway signature; pursue ambitious capture-to-consequence, plan, goal, insight, and achievement choreography with performance/reduced-motion gates.

Anything not changed by these decisions remains provisionally accepted from the master plan.

---

## Research sources used

- [On or Off Track: How Broken Streaks Affect Consumer Decisions](https://academic.oup.com/jcr/article/49/6/1095/6623414)
- [How Gamification Affects Software Developers: Natural Experiment on GitHub](https://arxiv.org/abs/2006.02371)
- [When Gamification Spoils Your Learning](https://arxiv.org/abs/2203.16175)
- [OECD: Digital Delivery of Financial Education](https://www.oecd.org/content/dam/oecd/en/publications/reports/2021/01/digital-delivery-of-financial-education_e9c6655c/d02549e7-en.pdf)
- [Goal Setting and Saving in the FinTech Era](https://onlinelibrary.wiley.com/doi/full/10.1111/jofi.13339)
- [Apple Human Interface Guidelines: Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding)
- [Apple Human Interface Guidelines: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- [OpenAI: Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/)
- [OpenAI Agents SDK: Human in the Loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- [Firestore: Offline Data](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
- [MDN: Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [web.dev: PWA Platform Overview](https://web.dev/learn/pwa/progressive-web-apps)
- [web.dev: Animation Performance](https://web.dev/articles/animations-overview)
- [web.dev: Core Web Vitals Thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- [W3C: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
