# AGENTS.md

## Project Overview

Rushd / رُشد is a bilingual personal-finance assistant for younger people managing one dominant spending pool. The current app is a Vite-built modular Vue 3 prototype. The approved destination is an offline-capable, account-synced PWA with deterministic financial logic, deeply integrated AI, and a premium Arabic/English experience.

## Source Of Truth

The Vite entry is `index.html`; `src/main.ts` is the application composition root.

Product and implementation authority, in order:

1. `docs/RUSHD_MASTER_PLAN_FINAL.md`
2. `docs/implementation/phase-plan.json`
3. `WORKFLOW_LITE.md`
4. This file
5. `docs/RUSHD_EXECUTION_PROTOCOL.md` and the P00 phase machinery are historical audit records unless the founder explicitly requests a formal governed run.

Workflow Lite supersedes the old execution protocol's receipts, state transitions, mandatory per-phase reviews, and ordinary authority amendments. The master plan's product invariants and phase acceptance outcomes remain binding.

The July `docs/RUSHD_MASTER_PLAN.md` and August founder discussion/feedback files are preserved decision history. They are superseded wherever the final master plan differs.

Historical migration note for this local workspace: the latest version used to update this repository originally came from:

`C:\Users\mehme\Desktop\Rushd\Rushd 3.1.html`

Do not edit or delete that local historical file unless the user explicitly asks. Future public work should treat committed repository files as the source of truth.

## Run And Validate

Install dependencies, then run the Vite development server:

```bash
npm install
npm run dev
```

For a production-shaped local check, run `npm run build` followed by `npm run preview`.

Run the lightweight repository and finance-rule checks:

```bash
npm test
```

Run the optional browser smoke test after installing dependencies:

```bash
npm install
npm run test:browser
```

Manual QA checklist lives in `docs/manual-qa.md`.

## Important Files

- `index.html`: thin Vite host, metadata, font links, pre-paint boot, and static cinema shell.
- `src/main.ts`: app composition root and ordered style/template imports.
- `src/app/`, `src/components/`, `src/data/legacy-v1/`, `src/shared/`, `src/styles/`: owned P02 compatibility modules.
- `README.md`: reviewer-facing project overview.
- `docs/architecture.md`: app structure and data flow.
- `docs/data-model.md`: implemented and planned entities.
- `docs/privacy-notes.md`: finance-data privacy notes.
- `scripts/smoke-check.mjs`: static repository smoke check.
- `scripts/finance-rules.mjs`: first extracted finance-rule helpers.
- `scripts/browser-smoke.cjs`: optional Playwright browser smoke test.
- `docs/RUSHD_FINAL_FOUNDER_BRIEF.md`: concise approved product description.
- `docs/RUSHD_MASTER_PLAN_FINAL.md`: canonical product and technical contract.
- `docs/implementation/phase-plan.json`: machine-readable phases and acceptance gates.
- `docs/implementation/ACTIVE_DELIVERY_PLAN.md`: current phase status, model routing, acceleration plan, and Astra handoff context.
- When resuming Development Master work after a model change or compaction, read `docs/implementation/DEVELOPMENT_MASTER_HANDOFF.md`, then the active delivery plan. They hold current decisions and the next action; historical chat prompts may be stale.
- `docs/implementation/P02_EXECUTION_PLAN.md`: chosen P02 architecture, task boundaries, model routing, and proportional gates.
- `docs/RUSHD_EXECUTION_PROTOCOL.md`: manager/worker/reviewer state machine.
- `.agents/skills/rushd-phase-orchestrator/SKILL.md`: reusable phase orchestration workflow.
- `.agents/skills/rushd-motion-lab/SKILL.md`: Rushd-specific signature-motion prototype and verification loop.

## Coding Guidelines

Keep migration changes conservative and phase-bounded. Protect the current data and characterized behavior before restructuring; do not preserve a known bug as the final product. Refactor P02 compatibility modules only through the approved phase gates and browser/data checks.

Arabic and English are equal-quality launch languages. Preserve the current Arabic fonts subject to license verification. Preserve RTL layout, use `dir="ltr"`, `bdi`, or `unicode-bidi: isolate` for numeric/currency fragments when needed, and design English/LTR intentionally rather than as an afterthought.

Financial calculations should be explicit and testable. Do not silently change budget, safe-to-spend, vault, or recurring-template behavior without documenting the reason and testing realistic edge cases.

## Privacy Rules

Do not commit secrets, API keys, `.env` files, real financial data, personal screenshots, or user records. Demo data must be clearly fake. Rushd currently stores app data in IndexedDB and preferences in localStorage.

## What Not To Change Casually

- Do not rename the IndexedDB database without a migration plan; the legacy name is preserved to avoid data loss.
- Do not remove export/import or reset flows without replacing them.
- Do not claim model integration, cloud sync, authentication, or production security unless implemented.
- Do not add heavy frameworks unless the user accepts a migration plan.
- Do not change the locked permanent hierarchy: Home, Plan, Ask Rushd, Insights, Goals. Transactions remains a secondary full-history screen from Home.
- Do not reward spending amount, underspending, wealth, transaction count, or app opens in Momentum.
- Do not let AI write canonical finance data directly; it must use typed proposals and the deterministic command/action layer.
- Do not claim PWA, sync, account, AI, security, backup, residency, or release readiness until its phase gate has passed.

## Future Agent Workflow

Follow `WORKFLOW_LITE.md`. Read the relevant phase contract and product invariants, inspect only the relevant code, implement a coherent work slice, run logically scoped tests, and return a concise implementation report. The Development Master assigns tasks, verifies outcomes, and decides when independent review is warranted. Preserve financial-safety, migration, bilingual, accessibility, privacy, AI-proposal, and release-quality invariants; do not reintroduce receipt ceremonies, patch manifests, or state-machine transitions for ordinary development.

## Master cost and handoff rules

- Treat Master context and turns as scarce. Use Codex primarily for monitoring and return paths. Use Muse's available free capacity and Grok for substantial implementation, correction, review, and gates according to `WORKFLOW_LITE.md`; Luna xHigh/Max is only an occasional simple bounded exception. Short manager decisions and edits may be cheaper to finish directly.
- Route product-diff review, test execution, and evidence packaging to a cheaper capable reviewer. The Master adjudicates the packaged result; direct hands-on verification is an explicitly disclosed exception.
- Once delegated work is the only remaining action, end the turn. This includes reviewers and audits, not just external implementations. Do not poll, wait in a loop, inspect partial work, or repeat the assigned task.
- Reuse verifiable review/test evidence at the same product commit. Keep required independent safety review; repeat gates only for a concrete reason. Assign one integrated-gate owner.
- Save manual prompts as files with exact report paths. Tell the founder the app/model, effort and reason, short instruction to paste, and next action.
- Prepare and disclose an unattended launch before requesting approval. After approval, verify one writer and one cheap monitor, then end the Master turn. The monitor must preserve continuity by resuming an approved same session after a mechanical stop within `WORKFLOW_LITE.md` limits, or alerting the Master when safe recovery is unclear. Confirm the real notification/resume mechanism; do not promise a background loop that is not running.
- For unattended status, follow the evidence-state rules in `WORKFLOW_LITE.md`. A PID or screen proves presence only; call work progressing only after an observable delta, and recover a 20-minute three-check stall under the approved same-session limits.
- Use current routing, not old phase-role defaults. Delegated Sol is rare and Medium/High only. Prepare a bounded Astra consultation and explain why it is needed before seeking approval.
- Involve Astra in consequential taste work, including design, typography, interaction feel, and animation, through the approved consultation or implementation route.
- Read completed reports and take the next authorized step without another permission round. Respect explicit phase stops. Share useful concerns and recommendations in simple language.
