# Rushd Strategic Review Packet

**Prepared for:** one external senior product/engineering reviewer  
**Date:** 2026-08-23  
**Purpose:** review the delivery strategy before Rushd enters normal Phase 1 implementation.  
**Requested output:** a candid, decision-oriented advisory memo.

## Reviewer mission

The founder is not a developer and does not want to run a large-company process. Rushd already survived a high-rigor but token-expensive governed workflow. The team has now replaced it with a lighter workflow intended to preserve only the safeguards that protect money, data, bilingual quality, and honest release claims.

Your job is to review the situation as a senior product/engineering advisor. Identify the issues that actually matter before weeks of implementation are committed: product scope, delivery sequence, process risk, verification balance, model usage, and the first P01 slice. Favor high-leverage observations over completeness. If a concern is minor or theoretical, leave it out.

## 1. Product in one page

Rushd / رُشد is a bilingual Arabic/English personal-finance assistant for younger adults managing one dominant pool of spending money. The launch audience is 18+. The central question is:

> After actual spending, remaining commitments, and deliberate allocations, how much is genuinely available for extra spending right now—and why?

The differentiator is expected-versus-actual reconciliation and recovery after tracking gaps, not merely AI expense entry. Version 1 intentionally covers one spending pool, one active cycle, one base currency, and one active plan. It is not bank aggregation, double-entry accounting, investment advice, debt optimization, household finance, or regulated advice.

The permanent navigation hierarchy is locked:

1. Home
2. Plan
3. Ask Rushd
4. Insights
5. Goals

Transactions is a secondary full-history screen reached from Home, not a sixth permanent destination.

### Launch ambition

The approved destination is an offline-capable Vue 3/Vite/TypeScript PWA with:

- deterministic and explainable financial logic;
- local-first data;
- account sync;
- deeply integrated AI through typed proposals;
- equal Arabic RTL and English LTR quality;
- premium motion and interaction design;
- safe import/export/reset/migration behavior.

AI may propose actions, but it must never directly write canonical finance data. Every mutating proposal passes deterministic validation, preview, appropriate confirmation, atomic execution, receipt/audit support where needed, and undo when mathematically safe.

## 2. Current technical reality

The repository entry point is still a 10,194-line static single-file Vue 3 prototype in `index.html`. It contains UI, styles, storage wrappers, business logic, and finance behavior together. This is useful as a behavioral baseline but unsuitable for the final architecture.

Current data uses IndexedDB stores for expenses, templates, settings, vault goals, vault transactions, and month-end settlements. Preferences partially mirror localStorage. Production money is currently represented as major-unit JavaScript numbers, although the approved target moves canonical finance amounts toward integer halalas during domain extraction.

The implementation branch is `codex/rushd-rebuild-plan`. As of this packet:

- latest commit: `33ffce3 Rushd P00: protect authority and baseline`;
- parent: `3f83568 Rushd authority: accept reconciliation head drift`;
- nothing has been pushed;
- `WORKFLOW_LITE.md` exists but is not yet committed;
- `AGENTS.md` has an uncommitted edit pointing ordinary work to `WORKFLOW_LITE.md`;
- the full `npm test` gate currently stops at `scripts/verify-p00-baseline.mjs` because that verifier still pins the previous authority tip rather than accepting the newer P00 commit.

That failure is expected infrastructure debt, not evidence of product corruption. The first P01 task should make the verifier durable and then proceed to real corruption containment.

## 3. Why the old workflow became too expensive

The original workflow was designed around:

- immutable lifecycle receipts;
- exact patch manifests and hashes;
- append-only run-state journals;
- typed state-machine transitions;
- separate worker, manager, and independent reviewer sessions;
- disposable isolated review worktrees;
- formal authority amendments;
- byte-exact preservation of reviewed artifacts.

This machinery produced real value during Phase 0:

- it preserved visual, accessibility, performance, storage, migration, and defect baselines;
- it created executable reproductions for eight P0 and twelve P1 issues;
- it prevented silent mutation of reviewed evidence;
- it made authority changes auditable;
- it forced independent verification instead of trusting “done” claims.

But ordinary development became buried in ceremony. Small changes triggered patch manifests, receipt chains, transition records, reviewer packages, hash recomputation, and authority amendments. The human founder became a messenger between agents. Multiple sessions were spent repairing workflow infrastructure rather than shipping product work. The cost was especially bad because several participants were strong models and every formal step consumed expensive tokens.

The founder’s judgment is directionally correct: too much safety became its own project. The useful question is not whether the old system was rigorous—it was—but which protections actually reduce product risk and which merely prove that process happened.

## 4. New active workflow

The new operating document is `WORKFLOW_LITE.md`. Its core rules are:

1. The founder owns product intent, accounts/providers/publication, manual experience, and major tradeoffs—not routine technical administration.
2. The Development Master plans, sizes tasks, makes technical decisions, verifies outcomes, and decides when independent review is warranted.
3. A Worker implements a coherent slice in a dedicated chat and returns a concise report.
4. An independent Reviewer is used only for expensive-to-get-wrong or subjective-quality work.
5. Ordinary tasks do not require receipts, patch manifests, lifecycle transcripts, or state-machine transitions.
6. Tests verify meaningful behavior, not coverage theater.
7. Each coherent task becomes one focused report and usually one commit.

### Task sizing

A normal task should be a respectable slice, such as:

- a complete user-visible flow;
- a complete financial-safety fix plus regression coverage;
- a bounded behavior-preserving refactor;
- a complete infrastructure capability;
- a documented containment for a defect whose permanent fix belongs later.

Related edits belong in the same task unless risk, uncertainty, review size, or dependencies make splitting genuinely useful.

### Verification tiers

**Tier 0 — Master direct:** docs, comments, formatting, small tooling, obvious cleanup.  
**Tier 1 — Master technical verification:** normal features, refactors, bug fixes, and UI changes.  
**Tier 2 — Independent Reviewer:** financial calculations, data mutation/import/export/reset/migration, sync/auth/security/privacy, AI proposals/output handling, release readiness, major architecture choices, and significant visual/motion/bilingual UX.

For important UI or animation work, the Reviewer may record live video and inspect it visually instead of relying only on static screenshots.

### Non-negotiable invariants retained

- Arabic and English receive equal design quality.
- Financial calculations remain explicit, testable, and honest about real availability.
- Existing user data is never silently lost.
- Destructive operations require confirmation and safe containment.
- Canonical money moves toward integer halalas during domain extraction.
- AI never writes canonical finance data directly.
- Sync, security, production readiness, residency, PWA, and release readiness are never claimed before implemented and verified.
- Momentum does not reward spending amount, underspending, wealth, transaction count, or app opens.

## 5. Immediate phase: P01

P00 is closed. P01 is **Immediate corruption containment**. Its objective is to fix or visibly block prototype workflows that can corrupt, duplicate, erase, or materially misstate financial data.

The canonical P0/P1 inventory includes:

### P0 defects

- paid plan history mutation;
- partial/non-atomic plan application;
- partial import;
- duplicate/non-atomic settlement retry;
- false cycle surplus from unpaid reserved obligations;
- goal double counting against the full vault balance;
- legacy vault disappearance once transaction history exists;
- dangerous reset blockage/partial preference deletion.

### High-priority correctness risks

- UTC/local-date mistakes;
- floating-point money;
- historical budget rewriting;
- Home date/month mismatch;
- false weekly pace;
- missing monthly schedule day;
- ignored assignment effective date/profile;
- stale derived state races;
- weak numeric validation;
- weak import schema;
- misleading hard-coded analytics;
- gamification incentives based on wealth or underspending.

### Proposed P01 split

The new workflow deliberately breaks P01 into three coherent slices rather than one monolithic prompt.

**Task 1 — Unblock tests and protect money truth**

- replace the obsolete fixed authority-tip check with durable baseline-preservation checks;
- allow legitimate future work while failing if P00 evidence is deleted or mutated;
- prevent paid generated activity from being mutated by plan reconciliation;
- make surplus/accounting honor unpaid reserved commitments;
- strengthen unsafe numeric input rejection;
- add focused regressions.

**Task 2 — Contain dangerous writes**

- make plan apply atomic or visibly blocked;
- make import strict and atomic or visibly blocked;
- make settlement retry idempotent;
- stop reset from corrupting or stranding user data;
- preserve legacy vault behavior;
- add focused coverage.

**Task 3 — Stability and proof**

- contain/test UTC/date issues;
- prevent historical budget rewriting;
- guard stale derived state;
- verify capture/export/reload;
- record Arabic/English manual QA;
- build `docs/baseline/P01-risk-matrix.json` mapping every canonical P0/P1 item to regression plus fix/containment/final owner.

After P01, P02 introduces the production foundation and mechanical split into Vue/Vite/TypeScript modules while preserving behavior and legacy data access.

## 6. Model allocation

Available resources change frequently, so the plan should optimize for capability placement rather than fixed brand loyalty.

### Current roles

**Development Master — ox-alpha in Codex/T3 Code**  
Owns planning, task cards, technical judgment, result triage, integration, and escalation. Should remain clean and directional rather than reading every implementation detail repeatedly.

**Worker — GLM 5.3 in ZCode**  
Implements assigned slices, runs scoped tests, reports honestly. Strong enough for real implementation work and currently the main practical labor pool, with roughly 150M tokens remaining.

**Independent Reviewer — preferably another ox-alpha instance/subagent**  
Used selectively for Tier 2 changes. Reviews actual diffs, behavior, tests, screenshots/video, and risk—not paperwork.

**Bulk/mechanical helper — Gemini 3.7 Flash**  
Near-unlimited supply but not reliable enough for architecture, finance safety, migration, sync, security, AI actions, or nuanced bilingual UX. Useful only for bounded mechanical work with explicit checks, if at all.

**Strategic second opinion — GPT 5.6 Sol or Fable 5**  
Best reserved for major cross-phase decisions like this packet, not ordinary implementation.

### Allocation principle

Use cheap/infinite models only where failure is easy to detect and cheap to correct. Spend capable-model tokens on planning, ambiguous implementation, money/data safety, subjective UX, and review. Avoid using the strongest model as a typist or using the cheapest model as an unverifiable authority.

## 7. Founder’s stated preferences

These are direct constraints, not suggestions:

- explain choices in simple language;
- focus attention on actual product progress;
- remove most formal authority work;
- keep useful verification without overtesting;
- make tasks bigger and more coherent than before;
- avoid turning the project into slow enterprise bureaucracy;
- ask the founder only for genuine product/account/legal/deployment decisions;
- treat the founder primarily as director and middleman between agents, not as a developer.

## 8. Primary artifacts for deeper inspection

If deeper context is required, read these in the repository:

| Priority | Path | Why it matters |
|---|---|---|
| 1 | `docs/RUSHD_MASTER_PLAN_FINAL.md` | Canonical product and technical contract |
| 2 | `WORKFLOW_LITE.md` | New lightweight delivery process |
| 3 | `docs/implementation/phase-plan.json` | Machine-readable phases and acceptance gates |
| 4 | `docs/implementation/P0-P1-INVENTORY.md` | Canonical P0/P1 defect inventory |
| 5 | `AGENTS.md` | Repository-level agent rules and invariants |
| 6 | `index.html` | Current 10k-line prototype and behavior source |
| 7 | `scripts/verify-p00-baseline.mjs` | Current stale-tip test blocker |
| 8 | `docs/baseline/` | P00 fixtures, visual/perf/accessibility evidence, reproductions |

The original execution protocol remains useful history but is no longer the default operating system.

## 9. Useful review angles

Use these as thinking prompts, not a mandatory questionnaire:

- whether Workflow Lite preserves enough protection for a personal finance app;
- whether the P01 split has the right order, size, and verification balance;
- whether dangerous-write containment should precede user-visible improvements;
- whether the future move from single-file prototype to modular Vue/Vite/TypeScript remains justified;
- whether the broader master plan should stay as-is, shrink, or reorder;
- which review triggers are worth keeping, adding, or removing;
- how to use the remaining Development Master and GLM budgets for the highest-leverage work;
- what lightweight checkpoint gives the founder confidence without recreating ceremony;
- the most likely way this plan wastes time despite the lighter workflow.

## 10. Requested response

Return a concise advisory memo—roughly 800–1,200 words—with these headings:

1. **Overall judgment**
2. **Keep working**
3. **Change before P01**
4. **Workflow and verification advice**
5. **P01 sequencing and sizing**
6. **Product scope and model use**
7. **Next concrete step**

Write for a non-technical founder. Be candid rather than diplomatic. Prefer specific recommendations over restating the packet.
