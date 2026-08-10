# Rushd Founder Review

## What this is

This is the readable companion to the 3,409-line [master plan](RUSHD_MASTER_PLAN.md). It does **not** replace it or authorize a rewrite by itself. The master plan remains the implementation reference; this document is the part to read, react to, and use to make founder decisions.

Read this first. Then send your decisions, concerns, and edits in the response template near the end. Codex can turn the approved direction into a focused implementation charter.

---

## Rushd in one clear sentence

Rushd should help Saudi students and early earners say what they spent in ordinary Arabic, keep their monthly plan honest, and understand what is still available—without bank linking, shame, or hidden financial changes.

The product is **a calm spending-clarity companion**, not a bank, accounting suite, investment app, or generic AI chatbot.

The core loop is deliberately small:

> Plan the month → say what happened → review it → see what changed → make one useful decision.

The one answer Rushd must earn the right to show is:

> **المتاح وفق خطتك — Available according to your plan**

It means: starting money, minus what has actually been paid, minus commitments the user chose to reserve, minus money deliberately allocated away from this month. It is not a promise that a user can spend freely, and it should never pretend to be complete when Rushd lacks important information.

---

## The product we are choosing

### Who it is for

The recommended first audience is Arabic-speaking people in Saudi Arabia who manage one main monthly pool of money: university-age students, scholarship recipients, interns, allowance users, and people in their first independent-income years.

They want to know what remains after everyday spending and known commitments. They do **not** want a complicated finance system or to link a bank account just to understand their month.

For the first external beta and public launch, the plan recommends an **18+** audience. Minors, families, businesses, investments, debt optimization, tax/zakat advice, and multiple bank accounts are intentionally outside the first release.

### What the experience should feel like

- Arabic-first and RTL by design, not merely translated.
- Calm, direct, and non-judgmental.
- Useful in seconds, with detail available only when needed.
- Precise underneath: every amount, reservation, change, and explanation has a traceable basis.
- Helpful AI at the edge, but the user remains in control.

### What Rushd will keep and improve

| Keep | Improve |
| --- | --- |
| Arabic-first identity and RTL foundation | Make Arabic copy, numbers, dates, and mixed-language text consistently clear |
| Expected-versus-actual spending | Make reconciliation safer and easier to understand |
| Local-first storage, export, import, and reset | Make backups, restores, errors, and migrations dependable |
| Plans, routines, commitments, and flexible limits | Show them in plain user language rather than internal model jargon |
| Date context and category recognition | Make them accessible and useful, not decorative |

### What Rushd will deliberately remove

- Currency-based XP, levels, and status titles.
- Calling an underspend "savings" before the user actually allocates that money.
- Fake trend charts and decorative data that does not do anything.
- Shame, streak-loss pressure, leaderboards, or competitive finance mechanics.
- Dense permanent statistics and Settings-first navigation.
- Generic neon/glass-heavy "AI fintech" styling.

Instead, Rushd gets **Rushd Rhythm / إيقاع رُشد**: a gentle practice indicator that recognizes honest review, a realistic plan, a correction, a return after a gap, and making a backup. It never rewards having more money, spending less than somebody else, or logging extra transactions.

---

## The everyday product, in human terms

### First minute

Rushd opens by asking a simple question:

> وش صرفت آخر مرة؟

The user can type something like `قهوة 18، وأوبر 27 أمس`. Rushd turns it into clear, editable expense cards and asks for one visible confirmation before saving. Only after that first useful moment does it ask for the month's starting amount, because that unlocks the availability answer.

No account, notification permission, routine setup, goal setup, or cloud-AI permission should block that first win.

If someone joins mid-month, Rushd should be honest about what it does not know. It can start from today's remaining cash, invite a quick catch-up, or show a clearly incomplete "remaining in your records" status. It must not make an optimistic answer look certain.

### Daily use

1. The user says or types what happened.
2. Rushd interprets it into an editable proposal.
3. The user confirms it.
4. Activity and Home update.
5. Undo remains available.

Manual entry always remains easy. AI failure, no internet, or unclear wording must leave the user's draft intact and offer a usable fallback.

### Weekly and monthly use

The weekly review is five short cards and one decision—not a long dashboard. Month end is a guided chance to reconcile, understand what changed, decide whether to allocate money to a goal, and begin again.

If a user comes back after a lapse, Rushd should offer a gentle restart, a rough estimate, or a short catch-up. It should never make the missing period feel like a failure that invalidates the whole app.

---

## The screen plan in one page

The permanent mobile navigation is intentionally focused:

1. **الرئيسية — Home:** what remains, how certain the answer is, what needs attention, and one useful insight.
2. **النشاط — Activity:** the authoritative ledger, search, filters, details, corrections, refunds, and review inbox.
3. **رُشد + — Capture:** a central sheet for natural-language, voice, or manual capture. This is the main action, not a normal tab.
4. **الخطة — Plan:** monthly funds, commitments, routine, and spending limits in simple language.
5. **الأهداف — Goals:** tracked allocations and goals, with clear wording that Rushd does not hold or move real money.

Settings lives under the Home header. Insights opens from Home when there is enough meaningful data; it is not a wall of empty cards.

### The Home screen should answer only three questions

1. What remains available according to my plan, and how complete is that answer?
2. What needs my attention today?
3. What is the next useful action?

The visual signature is **مِقياس الرُشد — The Rushd Measure**: a restrained right-to-left measurement rail used only for real quantities—such as monthly funds, commitments, paid spending, and remaining availability. The visual direction is calm, precise, Arabic, and premium: indigo for structure, orange for the current action, no purple neon, fake charts, or blur-heavy cards.

---

## The non-negotiable trust rules

These are the most important parts of the plan. They are not optional polish.

1. **No silent financial changes.** Every consequential change is previewed, confirmed, explained, and where practical undoable.
2. **Paid history stays paid history.** Editing a plan may affect future expectations; it must not rewrite or delete posted payments.
3. **One financial calculator.** Home, Insights, reviews, and AI explanations all use the same deterministic calculation.
4. **Money and dates must be technically reliable.** Use integer minor units, correct Saudi time-zone handling, clear due versus payment dates, and explicit partial-payment/refund rules.
5. **Critical operations must be atomic.** Importing data, applying a plan, and closing a month must never leave half-completed data or duplicate results after a retry.
6. **Local-first remains real.** The manual ledger, plans, calculations, goals, backup, export, and existing data remain usable without an account or AI.
7. **AI may interpret and propose; it never becomes the financial source of truth.** It cannot write directly to storage, perform its own financial arithmetic, delete history, reset/import data, or move real money.

The existing prototype has valuable ideas, but the plan has identified real correctness risks in plan reapplication, month settlement, imports, goal allocation, dates, historical budgets, and validation. This is why Rushd should fix the foundation before adding an impressive assistant or a large visual redesign.

---

## What AI means here—and what it does not mean

The ambition is broad: eventually the assistant can explain expenses, plans, goals, onboarding, and insights in natural Saudi-friendly Arabic. But its authority remains narrow.

| It can do | It cannot do |
| --- | --- |
| Explain grounded facts from Rushd's calculated data | Invent financial figures or use its own calculation as truth |
| Turn natural language into a proposed expense or plan change | Save a financial change without a visible user confirmation |
| Ask when an amount, date, or reference is ambiguous | Delete history, reset/import data, or move real money |
| Offer an editable transcript and proposal for voice capture | Treat releasing the microphone button as a save action |

Cloud AI is **optional**, not a hidden data pathway. The plan's recommended promise is:

- The full ledger stays on the device.
- Rushd asks just before it needs cloud help.
- It sends only the smallest relevant context through a controlled gateway.
- There is no durable assistant memory unless the user explicitly enables it.
- Declining cloud AI preserves the draft and falls back to manual/local capture.

AI arrives late on purpose:

1. First, read-only grounded explanations.
2. Then, internal shadow proposals with no save route.
3. Then, confirmed typed expense saves, with audit history and undo.
4. Finally, voice and broader planning/goal proposals.

The first public version does **not** require the final, full AI assistant. A safe manual product comes first.

---

## What will not be built for the first public release

- Bank connection or open-banking aggregation.
- Multiple accounts, net worth, shared household budgets, or business accounting.
- Investments, credit, taxes, zakat, or legal advice.
- Paying bills or moving real money.
- Mandatory accounts or cloud sync.
- Receipt scanning, before typed and voice capture are genuinely excellent.
- Social feeds, public sharing, leaderboards, advertising, or selling financial data.
- A native app wrapper merely for store presence.

This is not a lack of ambition. It protects Rushd's advantage: conversational Arabic capture, explicit planning, local-first trust, and understandable financial answers.

---

## The delivery plan, without the engineering overload

The plan is deliberately staged. Each stage must be trusted before the next begins.

| Stage | What it makes true | What you should care about |
| --- | --- | --- |
| 0. Direction and baseline | Product decisions, current behavior, test fixtures, known bugs, and sample backups are documented | We agree on what Rushd is before changing it |
| 0.5. Safety containment | Known data-corruption paths are fixed, blocked, or clearly warned about | You can keep using the prototype without unknowingly risking key data |
| 1. Production foundation | The single giant HTML file becomes a maintainable Vue/Vite/TypeScript app without changing behavior | No risky big-bang rewrite and no dependence on runtime CDNs |
| 2. Trustworthy core | Money, dates, calculations, plans, storage, migrations, import, backup, and undo become testable and reliable | Rushd's main number can be trusted |
| 3. Design system and shell | The visual system, accessible components, navigation, RTL, keyboard behavior, and responsive app shell are in place | The new look is consistent before individual screens are rebuilt |
| 4. First real product slice | Capture, Activity, Home, first-value onboarding, offline/manual flow, and the availability answer work together | This is the first milestone you should see and judge as a real daily app |
| 5–6. Complete the local loop | Safe Plan/reconciliation, then goals, reviews, Insights, Rhythm, and privacy/backup settings | The full non-AI finance companion is complete |
| 7. Hardened PWA | Installation, offline startup, safe updates, recovery, performance, privacy, and release engineering | A small dogfood group can safely use it for a month |
| 8–9. Gated AI and voice | Read-only AI → shadow proposals → confirmed typed capture → voice/broader proposals | AI earns write authority through evidence, not demos |
| 10. Closed beta and public PWA | Real users, support/restore drills, legal/privacy review, and quality evidence | Public launch happens when trust is proven, not on a guessed date |
| 11. Optional sync/native | Sync or a native wrapper only if real user evidence justifies their cost and risk | These are later product choices, not vanity milestones |

The important sequencing rule is simple:

> Do not put AI, animation, or a native app ahead of the reliable financial core. They only amplify the quality—or the mistakes—already underneath.

---

## The four decisions that need your real input now

The master plan lists eight choices, but only four need an active founder decision before work starts. The recommended defaults below are sensible; you can approve them, change them, or ask for options.

### 1. Launch audience

**Recommended default:** Saudi university-age students, scholarship recipients, and people in their first independent-income years, each managing one monthly pool of money. External beta/public launch is 18+.

**Your question:** Is this the person you most want Rushd to serve first, or is there a different primary user with a meaningfully different financial life?

### 2. AI privacy and funding promise

**Recommended default:** The ledger stays local. Cloud AI is optional, clearly consented, and receives minimized per-request context. The local finance core stays free and ad-free; AI can later be funded by a transparent optional Rushd Plus allowance/subscription.

**Your question:** Are you comfortable offering optional cloud AI under this explicit consent model, or is an on-device-only promise more important than better Arabic language and speech capability?

### 3. Art direction

**Recommended default:** Approve **The Rushd Measure**: calm instrument-like surfaces, retained Arabic fonts, indigo structure, orange action, a sparse measurement rail, and no neon/glass/fake-chart treatment.

**Your question:** Does this feel like Rushd? If not, describe the feeling or visual references you want instead—not implementation details.

### 4. First publishing surface

**Recommended default:** Ship an installable public PWA first. Add a Capacitor/native wrapper only when features such as reliable reminders, biometric lock, secure-key storage, or store discovery genuinely justify it.

**Your question:** Is an app-store presence a firm launch requirement for you, or can Rushd prove its daily value as a PWA first?

---

## Defaults you can simply accept unless you feel strongly

- **Assistant personality:** warm, calm, concise, Saudi-friendly Arabic; answers first, evidence second, one optional next step; never childish, preachy, or shaming.
- **Calendar:** Gregorian months remain the financial period. Hijri dates are offered prominently as an optional display/input aid; true Hijri accounting periods are a later feature.
- **Cloud sync:** not in launch scope. Ship encrypted portable backups first and let real device-loss/multi-device demand decide whether sync is worth its added privacy, account, legal, and operational burden.

You do **not** need to decide the exact AI provider, database library, TypeScript details, native wrapper, price, or launch date now. The plan intentionally defers those decisions until they can be made with technical or beta evidence.

---

## My recommendation for how to handle the master plan

Do **not** try to approve 3,409 lines one by one. It is a valuable reference, but it is the wrong format for your first pass.

Treat your review as three short conversations:

1. **Product bet:** Who Rushd is for, the one core promise, what it will not be, and whether The Rushd Measure fits the brand.
2. **Trust contract:** The financial rules, local-first privacy promise, and the principle that AI only proposes.
3. **Delivery order:** Approve the sequence through the first real milestone—Phase 0, 0.5, 1, 2, 3, and 4. Everything after that should remain gated by evidence.

If those are right, the large reference plan has done its job. The next thing Codex should produce is **not a massive rewrite**. It should produce a compact Phase 0 execution charter and acceptance checklist, then begin the first safe checkpoint.

---

## A simple way to give feedback

You can reply in ordinary language, voice-note style, or use this copy-and-paste template. Short answers are enough.

```text
Overall: [approve the direction / I want to change it / I have questions]

1. Audience:
   [approve / change to ...]

2. AI and privacy:
   [optional cloud AI is okay / I want on-device only / change ...]

3. Visual direction:
   [The Rushd Measure fits / I want it to feel more ... / I dislike ...]

4. Launch surface:
   [PWA first is okay / app stores are required because ...]

5. The most important thing Rushd must do for a user:
   [...]

6. Things I do not want Rushd to become:
   [...]

7. Concerns or questions before implementation:
   [...]

8. Proceeding default:
   [Use the remaining recommended defaults / I want to discuss ...]
```

When you send that response, Codex should turn it into a small decision log, revise the parts of the master plan that your choices affect, and start Phase 0 rather than trying to build the entire future at once.

---

## If you want more detail

Only open these master-plan sections when they answer a question you actually have:

| If you want to understand… | Read in the master plan |
| --- | --- |
| The product vision, core calculation, non-goals, and public 1.0 scope | Sections 3–5 |
| Exactly how the assistant remains safe | Section 6 |
| The screens, mobile interaction, art direction, and Rhythm | Sections 7–10 |
| Why the financial/core migration needs to happen first | Sections 11–17 |
| The work order, risks, success measures, and choices | Sections 18–21 and 23 |

You do not need to read the technical data-model, architecture, test, PWA, or privacy detail before making the four founder decisions above. Those sections are there to keep the later implementation honest.
