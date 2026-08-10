# Rushd Research Audit — 10 August 2026

**Purpose:** Record what was checked, what changed in the final plan, and the limits of the
evidence. This is not required founder reading; it is the source trail behind the plan.

## 1. Repository evidence

Verified baseline:

- `main` and `origin/main` are `ed45d83d235e230f9d530de6c421f68c3dd5020b`.
- `index.html` is 10,194 lines and 507,962 bytes.
- It is a single global Vue 3 app with inline template, styles, logic, and CDN dependencies.
- Persistence is IndexedDB `MicroSaveOS_DB` v1 with `settings`, `templates`, and `expenses`,
  plus localStorage preferences.
- There is no Vite build, TypeScript app, manifest, service worker, backend, auth, sync, or
  real AI integration.
- `npm test` passes, but production does not import the separately tested finance helper;
  the result is a repository smoke signal, not release proof.

Confirmed high-risk findings include UTC-based today, floating-point money, mutable global
allowance affecting history, plan reapplication mutating paid generated items, non-atomic
plan/import/settlement workflows, unpaid obligations omitted from surplus, goal double
counting, legacy vault disappearance, weak import validation, and reset blocking.

These findings determined the sequence: evidence, containment, modular split, canonical
domain, migration, then product rebuild.

## 2. Product and competitor research

Products reviewed included:

- [YNAB features](https://www.ynab.com/features) and [quick add](https://support.ynab.com/en_us/how-to-add-transactions-in-ynab-HyDwA_byi?mobile-help=true)
- [Monarch Flex](https://help.monarch.com/hc/en-us/articles/32125337244052-Understanding-Flex-Budgeting) and [recurring bills](https://help.monarch.com/hc/en-us/articles/4890751141908-Tracking-Recurring-Expenses-and-Bills)
- [Copilot quick start](https://help.copilot.money/en/articles/11157550-quick-start-guide), [FAQ](https://www.copilot.money/faq), and [Free to Spend](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview)
- [Quicken Simplifi Spending Plan](https://support.simplifi.quicken.com/en/articles/4212702-understanding-your-spending-plan)
- [PocketGuard](https://pocketguard.com/blog/six-tips-to-help-you-to-start-living-frugally-in-2026/)
- [Koma](https://heykoma.com/), [Breadsheet](https://trybreadsheet.com/), and [SysWallet](https://play.google.com/store/apps/details?id=cloud.sysflow.app)

Finding: AI capture, Arabic voice, and a left-to-spend number already exist in adjacent
products. Rushd's defensible combination is expected-to-actual reconciliation, a manual
pool reality-check, gap recovery, bilingual conversation, and deterministic explanation.

Changes made from this research:

- Added a recurring pool reality-check as a flagship feature.
- Moved payday-anchored monthly cycles into launch scope.
- Added a separate optional pacing answer and explicit negative/shortfall state.
- Made actual transaction history distinct from expected/unresolved activity.
- Added receipt/photo/screenshot capture after text/voice quality gates.
- Added user-visible learned merchant/category defaults and fast lapse recovery.
- Kept fast PWA deep links while deferring native-only widgets and richer OS shortcuts.

## 3. Retention research

Evidence reviewed:

- Streak status affects continued engagement, and repair opportunities can reduce the
  damage of a broken streak: [Silverman and Barasch, Journal of Consumer Research](https://academic.oup.com/jcr/article/49/6/1095/6623414).
- People optimize visible streak criteria, including creating activity shaped by the
  counter: [Moldon, Strohmaier, and Wachs](https://arxiv.org/abs/2006.02371).
- Autonomy, competence, and relatedness support self-motivation; controlling tangible
  rewards can undermine it: [Ryan and Deci](https://selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf).
- Habit formation depends on repeated context and varies substantially between people:
  [Lally et al.](https://onlinelibrary.wiley.com/doi/10.1002/ejsp.674).
- Notifications can disrupt and receptivity is context-dependent:
  [Mehrotra et al., CHI](https://discovery.ucl.ac.uk/id/eprint/1502364/).
- Self-set concrete goals and monitoring have more direct FinTech evidence than generic
  points: [Gargano and Rossi, Journal of Finance](https://onlinelibrary.wiley.com/doi/10.1111/jofi.13339).
- Gamified scores can displace the underlying purpose:
  [Mogavi et al.](https://arxiv.org/abs/2203.16175).

Decision: keep a real daily streak and strong visual reward, but define the criterion as
one completed daily review/check-in. Do not reward amount, underspending, wealth,
transaction count, category, or app open. Include a repair window/token, preserve durable
progress after a lapse, and measure pressure, corrections, farming, and recovery.

Evidence limit: the strongest streak research is not personal-finance bookkeeping. The
plan requires a four-week closed beta before effectiveness claims or escalation.

## 4. Motion and design research

Primary technical sources:

- [Motion for Vue](https://motion.dev/docs/vue), [LazyMotion](https://motion.dev/docs/vue-lazymotion), and [layout animation](https://motion.dev/docs/vue-layout-animations)
- [View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)
- [Web animation performance](https://web.dev/articles/animations-guide) and [rendering performance](https://web.dev/articles/rendering-performance)
- [`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- [Rive state machines](https://rive.app/docs/runtimes/state-machines) and [Canvas versus WebGL2](https://rive.app/docs/runtimes/web/canvas-vs-webgl)
- [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)
- [Apple physical-device Safari inspection](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)

Repository findings: 13 `transition: all` occurrences, four infinite animations, 27
blur/backdrop-filter uses, and overlapping CSS motion layers. The current system must be
consolidated before adding spectacle.

Decision:

- CSS/Vue transitions/WAAPI foundation.
- Selective lazy-loaded `motion-v` for gestures/layout/shared elements.
- View Transitions as progressive shell enhancement.
- GSAP only for an isolated timeline proven necessary.
- Rive only for an optional lazy decorative visual with cleanup and semantic fallback.
- No canvas/WebGL financial UI.
- Build six Motion Lab prototypes first and validate Full/Balanced/Reduced on real target
  devices before app-wide application.

The installed `frontend-design` skill is useful for art direction and intentional visual
decisions. Browser/Playwright capabilities are useful for reproducible comparison and
interaction verification. The Figma plugin would help only when an approved Figma source
exists; Remotion is useful for a storyboard/demo video, not as the runtime motion engine.

## 5. Backend, offline, and hosting research

Recommended production default:

- Supabase Auth + Postgres.
- PowerSync Web SDK with browser SQLite persistence selected by a physical-device VFS ADR.
  IndexedDB is a candidate, but the current Web SDK matrix does not support its multi-tab
  mode on Safari/iOS; benchmark the documented cooperative OPFS option and retain a
  per-platform adapter if one VFS cannot satisfy every target.
- Transactional Postgres RPC or Supabase Edge Function upload path.
- Separate local database for guest and each signed-in identity.
- Conventional PWA hosting, initially Cloudflare Workers Static Assets or equivalent.
- Authenticated provider-adapter gateway; OpenAI Responses API is the provisional first
  candidate and must win the frozen comparative benchmark before production lock.

Primary sources:

- [PowerSync client architecture](https://docs.powersync.com/architecture/client-architecture), [Web SDK/VFS](https://docs.powersync.com/client-sdks/reference/javascript-web), [consistency](https://docs.powersync.com/architecture/consistency), and [writes](https://docs.powersync.com/handling-writes/writing-client-changes)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [regions](https://supabase.com/docs/guides/platform/regions), and [anonymous auth caveats](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Firestore offline behavior](https://firebase.google.com/docs/firestore/manage-data/enable-offline), [transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), and [locations](https://firebase.google.com/docs/firestore/locations)
- [RxDB Supabase replication](https://rxdb.info/replication-supabase.html)
- [Electric writes](https://electric-sql.com/docs/guides/writes)

Why this choice: Rushd needs relational invariants and cross-record transactions as well as
offline-first multi-device behavior. Firestore has convenient offline caching but
last-write-wins documents and no offline client transactions; Supabase alone lacks a native
offline sync engine; PowerSync adds the missing local queue/checkpoint layer while leaving
backend validation to Rushd.

Hard gate: managed Supabase currently lacks a Middle East region while Firestore documents
a Dammam region. If legal review requires Saudi residency, use a Saudi-region architecture
or KSA-hosted Postgres with self-hosted PowerSync. Do not make this choice by assumption.

### ChatGPT Sites assessment

[Official Sites documentation](https://learn.chatgpt.com/docs/sites) supports hosting,
server execution, secrets, D1/R2, versions, custom domains, and ChatGPT identity. It is
useful for demos and controlled beta. Current official material does not establish the
general consumer auth path, service-worker/PWA lifecycle, Sites storage residency,
backup/restore/PITR, analytics compatibility, SLA, or offline-sync engine needed to make
it Rushd's sole production system of record.

Decision: do not depend on Sites for irreplaceable production financial history. Reassess
when those guarantees are documented and verified in a deployed PWA test.

## 6. AI and QA research

Architecture decision: model output is a proposal, never the database. The deterministic
command/action layer owns validation, before/after effect, commit, receipt, sync identity,
and undo/reversal.

QA sources and tools:

- [Vitest browser mode](https://vitest.dev/guide/browser/)
- [fast-check property testing](https://fast-check.dev/docs/introduction/)
- [Stryker mutation configuration](https://github.com/stryker-mutator/stryker-js/blob/master/docs/configuration.md)
- [Playwright projects](https://playwright.dev/docs/test-projects), [routing/failure injection](https://playwright.dev/docs/api/class-route), and [service-worker caveats](https://playwright.dev/docs/service-workers)
- [axe-core API and limits](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)
- [service-worker lifecycle](https://web.dev/articles/service-worker-lifecycle)
- [Core Web Vitals](https://web.dev/articles/vitals)
- [OpenAI eval guidance](https://developers.openai.com/api/docs/guides/agent-evals)

Decisions:

- Property and mutation tests for production finance logic.
- Immutable fixtures for every released storage schema.
- Failure injection after every durable write step.
- Two-tab/two-device conflict replay.
- Arabic/English/mixed AI eval corpus and human stratified review.
- Visual, accessibility, motion, physical PWA, performance, security, privacy, backup, and
  rollback evidence as independent blockers—not one aggregate quality score.

Optional plugins that become useful later:

- Sentry: privacy-reviewed production errors/performance, with redacted payloads.
- PostHog: consented, minimized product funnels/feature flags; never raw finance behavior.
- Codex Security: additional targeted review before public auth/sync/AI/import exposure.
- Supabase/Vercel/Cloudflare plugins: useful only after the matching provider is chosen and
  the founder installs/authorizes it.

No optional plugin is required to begin local implementation, and no plugin is a substitute
for deterministic tests or physical-device QA.

## 7. Codex orchestration research

Official sources:

- [Goal mode](https://learn.chatgpt.com/use-cases/follow-goals)
- [Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [Subagents and custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [App Server](https://learn.chatgpt.com/docs/app-server)

Decision: one long-lived Sol-high manager, fresh top-level Sol-high task for every phase,
one writer at a time, fresh independent reviewer for every attempt, durable JSON evidence,
and exact phase commits after review. The manager is explicitly authorized to use Codex
task-management tools, so no external controller is required for the desktop run. An App
Server controller becomes useful only if process-restart recovery or orchestration outside
the Codex app is later required.

The project-specific `rushd-phase-orchestrator` skill and custom agent files encode this
workflow so it does not depend on one enormous prompt staying perfectly in context.
