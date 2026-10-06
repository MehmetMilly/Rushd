# Rushd Development Master handoff

**Written 6 October 2026** by the Claude Code Development Master (Opus 5.5) taking over from the Codex era. It is for me, the next Development Master, in a new chat. Everything here was checked against the repository on 6 October unless it is marked *founder report* or *unverified*. The Codex-era version of this file is preserved verbatim in `archive/DEVELOPMENT_MASTER_HANDOFF_CODEX_2026-09-24.md`.

Read this file once, fully, then `CLAUDE.md`'s pointers as each area comes up. Keep it current: when state changes, edit the section it belongs to rather than appending a dated paragraph on top. That sediment is what made the Codex-era version unreadable.

## 1. Where things are

| What | Where |
| --- | --- |
| Working checkout | `/Users/mehmet/Desktop/Rushd-P04D-Restart`, branch `codex/p04d-restart` (a git worktree of the main repo) |
| Main repo / forensic checkout | `/Users/mehmet/Desktop/Rushd`, branch `codex/rushd-rebuild-plan` at `0bd25f1`: the **rejected** first P04-D attempt. Read-only evidence. Never build on it or merge from it wholesale. |
| Remote | `origin` = `https://github.com/MehmetMilly/Rushd.git`. The working branch has **no upstream** and is **71 commits ahead of `origin/main`** (none of P03-close→P04 is on GitHub). Pushing needs the founder's permission. |
| Agent reports and evidence | Restart era (12 Sep on): `artifacts/agent-reports/` in the working checkout (233 files), plus `artifacts/agent-prompts/` and `artifacts/p04d-rejected-0bd25f1/`. P00–P03 and pre-restart P04: `/Users/mehmet/Desktop/Rushd/artifacts/agent-reports/` (334 files). **Both gitignored, exist only on this Mac.** A loose untracked `agent-reports/` at the working checkout root holds nine rollback-era files, also uncommitted. |
| Stale worktrees | `git worktree list` shows 31 entries: 21 are prunable records of deleted `/private/tmp/rushd-*` review checkouts, plus six `~/.codex/worktrees/*`, `Rushd-dogfood` and `Rushd-worktrees/p03d-grok-review`. Harmless; `git worktree prune` only with permission. |
| Experiment copies | `Rushd-motion/`, `Muse Rushd`, `Astra Rushd`, `Sol Rushd`, `Opus Rushd`, `Rushd-Personal-Alpha`, `Rushd-dogfood` on the Desktop. See `MOTION_EXPERIMENTS.md` and §8. |

Key commits on `codex/p04d-restart`:

- `291228c` P03 closed (domain core).
- `4f48b6f` P04-C accepted (base of the restart).
- `e01e335` rollback status after the rejected shell.
- `f15900b` D1, `f193fdc` D2, `877eb27` D3, `82d3262` D4 (the single canonical-authority cutover).
- `9a3267b` last pre-takeover commit (factory reset without automatic export).
- `6268eb3` **P04 checkpoint, 6 Oct**: the uncommitted 22–24 Sep work (font subset, SW v4, boot gating, docs), committed unchanged at the founder's request.
- The commit after it holds this handoff, `CLAUDE.md` and the doc cleanup.

## 2. Verified state on 6 October

On this tree:

- `npm run lint`, `npm run typecheck`, and `npm test` pass. `npm test` covers the P00 baseline verify, repository checks, and 26 files / 205 domain tests.
- `PLAYWRIGHT_BROWSERS_PATH=0 npm run test:data` passes: 39 tests, the candidate experiment with its expected IndexedDB demotion, the P04-B gate 20/20, and P04-C.
- `PLAYWRIGHT_BROWSERS_PATH=0 npm run test:pwa` passes: static checks, 103 vitest tests and the browser lifecycle.
- Not rerun by me: `test:property`, `test:p04d5*`, `parity:*`, `test:rollback`, `test:characterization`.

**The phone-tested build is this tree.** A scratch production build of `6268eb3`'s content reproduced the exact bytes listed in `P04_D5_DEVICE_CHECKLIST.md` for the isolated device-gate deployment `dpl_2PKp8cCzPNN3YmK7Vizp4zgTzJzC`:

| File | Hash prefix |
| --- | --- |
| `index.html` | `5ba90c12` |
| `index-CPeO-cuI.js` | `3bf31e50` |
| `index-RBz2T2Xl.css` | `79ae3457` |
| SW | `c89e9d43` |
| font | `d24dd748` |

So the founder's phone results apply to exactly what is committed.

**What a brand-new user sees** (headless Chromium, real `npm run build` + `preview`, 390×844, both languages, no console errors):

- The established dark identity: an orange piggy-bank logo, and a "Safe to spend 0.00 SAR / Savings 0.0" card.
- A horizontal day strip.
- An empty state with an "Auto-Fill Schedule" button, and a FAB.
- A bottom nav of **Home, Statistics, Vault, Plans, Settings**.

## 3. P04 status: open, with a private-use checkpoint passed

P04 (local data v2, migration, PWA) is **not closed**, and must not be described as closed or release-ready. The founder approved a reduced private-use safety checkpoint instead (recorded in `phase-plan.json` → P04 `founder_private_use_checkpoint`, decision 23 Sep).

| Item | Status | Evidence |
| --- | --- | --- |
| iPhone short script (icons, offline fake writes/reopen, no-export reset, restore) | Passed, *founder report* | `artifacts/agent-reports/P04-D5-IPHONE-V4-FOUNDER-REPORT.md` |
| Galaxy A55 v2→v4 update, offline read/write/reload, two-tab | Passed, agent-observed over USB | `P04-D5-A55-V4-DEVICE-GATE.md` |
| A55 remainder (installed cold launch, backup/reset/import, old-tab rejection, radio-offline) | *founder report* "worked perfectly" (24 Sep) | same report + `ACTIVE_DELIVERY_PLAN.md` |
| Font subset + SW v4 on the isolated origin | Passed | `P04-FONT-V4-ISOLATED-GATE.md` |
| Reset/export bugs, stale updates, slow icons | Fixed and in `6268eb3` / `9a3267b` | the `P04-D5-*-CORRECTION*` and `*-REVIEW*` reports |
| Physical iPadOS, Mac Safari | **NOT_TESTED** (deferred by founder) | `P04-D5-MAC-SAFARI-GATE.md` |
| Quota exhaustion, private mode, kill-during-write, newer-schema rollback on devices | **NOT_TESTED** (no safe harness) | `P04-D5-PRECLOSURE-GAP-AUDIT.md` |
| P04-A6 physical VFS ADR | **Open** | `P04-D5-A6-VFS-GAP-AUDIT.md` |
| P04-A7 URL routes and Add/Ask shortcuts | **Open, deferred** to the navigation/core-product phase (founder: persisted view intent is enough for now) | `P04-D5-A7-GAP-AUDIT.md`, `P04-D5-A7-ROUTE-PLAN.md` |
| An earlier live English timeout on v3 | INCONCLUSIVE, superseded by v4; never claimed as pass | `ACTIVE_DELIVERY_PLAN.md` |

P05 carries an `early_start_exception` (23 Sep): visible P05/P06 design and core-product work may start now. Strict P04-A6/A7 stay open. This is not permission to publish.

## 4. Deployments (Vercel; touch none without permission)

| URL | What it serves |
| --- | --- |
| `https://rushd-p04d5-device-gate.vercel.app/` | Isolated test origin; `dpl_2PKp8cCzPNN3YmK7Vizp4zgTzJzC` = current tree. The founder's phones use it. |
| `https://rushd-dogfood.vercel.app/` | The legacy rollback (pre-restart app, from `/Users/mehmet/Desktop/Rushd-dogfood`). The "production" the founder rolled back to in September. |
| `https://rushd-personal-alpha.vercel.app/` | D4 `82d3262`, from the separate `Rushd-Personal-Alpha` repo. Superseded. |
| `https://rushd-expense-knot.vercel.app/?preview=expense-knot` | The Sol expense-knot experiment (legacy runtime). |

The founder confirmed on 6 Oct that **no deployment holds real financial data**; all of it is test data. Real personal data must still never be used without an explicit decision.

## 5. Architecture in one page

- **Shell.** `index.html` holds the pre-paint boot screen, which waits for `rushd:app-mounted` and for the icon font. `src/main.ts` is the composition root. The UI is still the P02 "legacy" Vue app (`createLegacyApplication`, runtime string templates `src/app/root-template.html` + `src/app/root-controller.js`, components in `src/components/`, CSS in `src/styles/`). There are no SFCs yet; the `vue` alias points at the runtime-compiler build (`vite.config.*`).
- **Restart architecture (Candidate B, compatibility-first).** It keeps that mounted UI and routes every behaviour through typed feature ports (`src/application/p04-d/contracts.ts`): authority, home, capture, history, plan, insights, goals, portability, navigation, lifecycle. Ports have legacy delegates (`legacy-ports.js`) and canonical implementations (`canonical-host.js`). The design and its reasons are in `P04_D_RESTART_ARCHITECTURE.md`; the D1–D5 sequence is in `P04_D_RESTART_PLAN.md`.
- **Authority latch.** `production-boot.js` sets `P04D_PRODUCTION_AUTHORITY = 'canonical'` and freezes the v1 writers (`freezeV1Writers`). Authority states are legacy / canonicalPreparing / canonicalReady / unavailable. "Unavailable" blocks writes with a truthful message (`p04dBlockedCopy(...,'authority')`). The single cutover happened in D4.
- **Data.**
  - Canonical v2 lives in SQLite on OPFS through a worker (`dist/sqlite-worker.js`, built by the `rushdWorkerAssets` Vite plugin).
  - The domain core is pure TS in `src/domain/` (activity, allocations, calculations, cycles, obligations, plans, recovery, sync), with integer halalas throughout.
  - Legacy v1 IndexedDB `MicroSaveOS_DB` is read once for migration and never written.
  - Portability gives versioned export/import, atomic import-replace with confirmation, and a factory reset that no longer forces an export.
- **PWA.**
  - Service worker `public/rushd-pwa-sw.js` uses cache `rushd-pwa-v4`, mirrored as `CANDIDATE_PWA_CACHE` in `src/pwa/registration.js`; the two must change together.
  - Navigations are network-first and assets are cache-first.
  - There is exactly one explicit `registration.update()` per boot.
  - Old `rushd-shell-*` caches from the rejected shell are retired.
  - Tab coordination blocks an old binary from writing over a newer schema.
- **Icons.** A Material Symbols Rounded subset (`public/fonts/...-subset.woff2`, ~50 KB, 48 glyphs listed in `src/components/material-symbol-icons.json`). It replaced the 5.36 MB full font, which the iPhone loaded slowly. The source font is kept in `font-sources/`. `ms-icon` renders `category` for unknown names, and `npm run test:font` / `tests/pwa/icon-font-contract.test.mjs` enforce the manifest. **Every new icon in P05 needs `npm run font:subset`.**

## 6. Product reality: what the canonical app can't do yet

P05/P06 must plan around these gaps. They are honest blocks, not bugs; each shows a truthful message rather than pretending.

- **A new user cannot fund the month.** The allowance is "read-only migrated history" (`p04dBlockedCopy` `allowance`), onboarding is blocked as "complete after migration", and `canonical-host.js` never invents starting funds. So a fresh install shows Safe to spend 0.00 forever, and every expense drives it negative. The domain has cycle commands (`applyOpenBoundaryCycle`, `applyRebaseOpenCycle`, `applyFundAllocationPool` in `src/domain/`), but no UI or host path reaches them. *Unverified* whether they fully cover new-user funding. This is P06-A1 onboarding and availability work, and the most important functional gap for a real daily user.
- **Blocked in canonical mode.** The `p04dBlockedCopy` call sites in `root-controller.js` cover:
  - template creation and template deletion
  - flexible items
  - pay/reopen
  - Auto-Fill
  - bulk mark-unpaid
  - template profiles/offdays
  - goal delete
  - allowance edit
  - onboarding
  - automatic month-end close

  Home's empty state still promotes the blocked **Auto-Fill** button.
- `budget` is always `null` in canonical Home stats (`canonical-host.js` ~line 2095). Safe-to-spend is shown only for the open month.
- **The navigation does not match the locked hierarchy.**
  - Today: Home, Statistics, Vault, Plans, Settings.
  - Contract: Home, Plan, Ask Rushd, Insights, Goals, with Settings as a persistent header action, never a tab.
  - There is no Ask Rushd destination at all.
  - Fixing this is P05-A1, and it is a consequential navigation change: show the founder a visible proposal first.
- There are no `test:ui`, `test:visual`, `test:e2e` or `test:a11y` scripts yet, though P05/P06 list them as required commands. Creating them is part of P05/P06.
- P05-A2 names IBM Plex Sans Arabic and Noto Kufi Arabic. *Unverified* whether the current self-hosted fonts already match those roles and licenses.

## 7. What comes next: the P05/P06 contract

From `phase-plan.json`. Read the full entries before planning.

- **P05 (Design system, locked shell, Motion Lab).**
  - A1 is the locked five-destination hierarchy on phone, tablet and laptop.
  - A2 is typography, direction and interaction foundations, documented and tested.
  - A3 is one motion-token source driving Full / Balanced / OS-Reduced.
  - A4 is that all six Motion Lab prototypes are recorded in three profiles with tests, perf traces and a selected/rejected decision. The six are: (1) add-button morph + capture sheet, (2) voice/text → structured expense cards, (3) confirmation flowing into the ledger and availability number, (4) Home→detail shared element, (5) Plan diff/reconciliation, (6) goal allocation + Momentum journey.
  - A5 is that no behaviour depends on motion and no competing transition engines.
  - A6 is a frozen 0–4 rubric scored independently: every dimension ≥3, distinctiveness and delight =4.
  - The required skills are `frontend-design` and `rushd-motion-lab` (`.agents/skills/rushd-motion-lab/SKILL.md`).
- **P06 (Core product vertical slice).** Onboarding (including 18+ self-attestation and new-user funding), the final Home hierarchy and Add menu, capture/history/edit/reverse, availability and Reality Check consistency, notifications, and daily recovery.
- **Founder sequencing (23 Sep, `artifacts/agent-reports/FOUNDER-PRIORITIES-2026-09-23.md`).**
  - Deliver visible progress in design, motion and useful interactions.
  - Use large coherent vertical slices, each owned through implementation and verification by one capable agent.
  - Keep the data-loss, wrong-money and destructive-action checks.
  - Avoid tiny handoff chains and repeated broad suites.

## 8. The founder: how to work together

- **Role.** The founder owns product intent, taste, publication, providers, money and legal. I own technical direction and routine decisions; I make those without asking.
- **Consult first** (rule of 11 Sep) on visual direction, core interactions, navigation, or feature scope. Show a concrete, visible proposal and the tradeoff.
- **Visual direction** (master-plan clarification, 11 Sep): *evolve* the established identity (screenshots in `docs/baseline/current/`). The founder rejected the replacement shell after using it, and the whole P04-D rollback and restart followed. A consequential departure needs the founder's decision on a visible proposal.
- **Taste.** Design and motion are the founder's highest creative priority, and the bar is extreme. `MOTION_EXPERIMENTS.md` records the reactions to five agents' motion attempts and what "crazy animation" means: iOS device and game-UI interaction quality, wild invention with immaculate finish, continuity of identity, motion with a visible cause, and every action authored. Read it before any P05 motion work. Self-graded "MASTERWORK" reports and frame-perfect test logs have never predicted the founder's reaction.
- **Communication.** Plain, short, lead with the result. The founder is blunt when unhappy; treat that as information about the work and answer it with better ideas and craft, not more mechanisms or more reports.
- **Hard limits.** Never push, deploy, publish, or touch Vercel without permission. Commit locally only when authorized, staging explicit files. Never use real personal data.
- **Open with the founder** (raised 6 Oct, not yet settled):
  - the **delegation model** for Claude Code ("we'll talk about it later")
  - whether and when to **push** the 71 local commits (nothing since P03 has an off-machine copy)
  - the **first P05/P06 slice** and the **navigation proposal**

## 9. Codex-era history: what still binds and what doesn't

Rushd was managed until 24 Sep by Codex Development Masters (GPT Sol/Astra/Luna) routing work to Muse Spark (OpenCode), Grok (Cursor), Gemini (Antigravity), Cline/Verdent models and Fable. Its rules live in `WORKFLOW_LITE.md`, the old `ACTIVE_DELIVERY_PLAN.md` sections and `archive/CODEX_MASTER_RULES_2026-09.md`.

**Still binding.** These are durable principles, not Codex mechanics:

- the evidence boundary: a worker's summary is a lead, a clean tree or claimed test is not proof
- one product writer per checkout
- independent review for finance, migration, destructive-action, security and major visual/motion work
- Arabic/English parity
- explicit git staging
- the founder-consultation rule
- recording genuinely deferred gaps with owner phase and required proof instead of reclassifying defects

**Superseded for me:**

- model routing tables, effort ladders and model budgets
- the "Master is a monitor" cost rules
- unattended worker/monitor/heartbeat machinery
- prompt files under `artifacts/` for manual pasting into other apps
- "Sol High is the Master"
- the process and routing parts of `.agents/skills/rushd-phase-orchestrator/` (its product-invariant reminders still hold)

How I delegate (subagents, workflows, other tools) is to be agreed with the founder.

**Why the history matters:**

- **P04-D was restarted once.** The first attempt (in `/Users/mehmet/Desktop/Rushd`) replaced the UI with a new shell; the founder used it, rejected it, and it was rolled back live. The restart therefore keeps the established UI and evolves it. Any P05 redesign that reads as "another replacement shell" will hit the same wall.
- The D4 cutover accepted **seven strict P00 pixel deviations** as canonical truth (founder-inspected, 13 Sep). `parity:quick` is intentionally red for populated/edit/profile/apply-plan states; do not "fix" it by weakening the comparator.

## 10. Risks

1. **Single copy of everything recent.** 71 unpushed commits and all evidence in the gitignored `artifacts/`. A disk loss erases P04. Raise the push decision early.
2. **Fresh-user funding gap (§6).** Rushd cannot yet serve a new real user's core job. P06 must close it before any real-data use.
3. **Deferred P04 risks.** iPadOS, Mac Safari, quota/private-mode/kill-write and A6 VFS are untested. Storage failure on Safari is the classic way local-first PWAs lose data.
4. **The phone checkpoint partly rests on founder reports**, not agent-observed steps (iPhone script, A55 remainder).
5. **Motion ambition vs. the runtime.** Every motion experiment bypassed the canonical runtime. Real P05 motion must work against canonical states, including blocked ones.
6. **The icon subset** makes any new icon a font rebuild, and missing icons fail quietly as `category`.
7. **Runtime-template Vue.** Templates are strings, so there are no template type checks; P05/P06 own the SFC conversion (`vite.config.*` comment).

## 11. Where to continue

1. Open with the founder. Settle delegation and push. Then show a visible P05/P06 proposal:
   - the locked navigation (Home, Plan, Ask Rushd, Insights, Goals + header Settings) mapped from today's Statistics/Vault/Plans
   - the first vertical slice
   - the motion direction to prototype first

   My recommendation for that slice is **capture → commit → ledger/availability** (Motion Lab prototypes 1 and 3) together with **new-user funding/onboarding**. It is the daily core loop, it was the founder's most-reacted-to area in every experiment, and the funding gap makes the app unusable without it.
2. Before code: freeze the 0–4 Motion Lab rubric (P05-A6) and the motion-token/profile source (A3), and add the missing `test:ui`/`test:visual` scripts.
3. Build on the canonical runtime in this checkout. Port ideas from the experiments (Gemini's tab pill, Sol's Cuff and Loom, the expense-knot's continuity-of-identity) without copying their files.
4. Judge in motion, Arabic first, on the device-gate origin only after the founder approves a deploy.

## 12. Evidence index

In-repo (committed):

- `docs/RUSHD_MASTER_PLAN_FINAL.md` (product contract)
- `docs/implementation/phase-plan.json` (acceptance, P04 checkpoint, P05 exception)
- `docs/implementation/ACTIVE_DELIVERY_PLAN.md` (status + decision history)
- `docs/implementation/P04_D_RESTART_ARCHITECTURE.md`, `P04_D_RESTART_PLAN.md`, `P04_D5_DEVICE_CHECKLIST.md` (device-gate identity and hashes)
- `docs/implementation/MOTION_EXPERIMENTS.md`
- `docs/architecture.md` (D4 section)
- `docs/baseline/current/` (established visual identity)

Local only (`artifacts/agent-reports/`):

- `FOUNDER-PRIORITIES-2026-09-23.md`
- `FOUNDER-MODEL-ROUTING-2026-09-21.md` (historical)
- `P04-D4.md`
- `P04-FONT-V4-ISOLATED-GATE.md`
- `P04-D5-IPHONE-V4-FOUNDER-REPORT.md`
- `P04-D5-A55-V4-DEVICE-GATE.md`
- `P04-D5-PRECLOSURE-GAP-AUDIT.md`
- `P04-D5-A6-VFS-GAP-AUDIT.md`
- `P04-D5-A7-GAP-AUDIT.md`
- `P04-D5-MAC-SAFARI-GATE.md`
- `P03-PHASE-CLOSURE-AUDIT.md` (this one is in `/Users/mehmet/Desktop/Rushd/artifacts/agent-reports/`)

Codex sessions (raw founder conversations, including the experiment briefs) are under `~/.codex/sessions/`.
