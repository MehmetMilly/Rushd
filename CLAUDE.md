# Rushd (رُشد)

Bilingual (Arabic RTL first, English LTR) personal-finance PWA for young people managing one main spending pool. Vue 3 runtime templates on Vite, a local SQLite (OPFS) finance core, offline-first, no accounts yet. The founder (Mehmet) is the only user and owns product, taste and publication decisions.

**Before any work, read `docs/implementation/DEVELOPMENT_MASTER_HANDOFF.md`.** It holds the verified current state, decisions with their reasons, open risks and exactly where to continue. Update it, and `docs/implementation/ACTIVE_DELIVERY_PLAN.md`, at every meaningful handoff.

## Where to work

- Work only in `/Users/mehmet/Desktop/Rushd-P04D-Restart` (branch `codex/p04d-restart`). `/Users/mehmet/Desktop/Rushd` is the same repo's rejected P04-D checkout, kept for forensics: read it, never build on it.
- Other `Rushd*` folders on the Desktop are disposable experiment copies; see `docs/implementation/MOTION_EXPERIMENTS.md` before reusing anything from them.

## Authority, in order

1. `docs/RUSHD_MASTER_PLAN_FINAL.md`: the product contract.
2. `docs/implementation/phase-plan.json`: phase acceptance outcomes and any founder amendments recorded in them.
3. The handoff and the active delivery plan: current status and founder decisions.
4. `AGENTS.md`: project invariants. `WORKFLOW_LITE.md`: Codex-era delivery method; its model routing and unattended-run machinery do not apply to Claude Code.

## Hard invariants

- Money is integer minor units (halalas); never floats, never rounding on migration.
- Canonical v2 data lives in SQLite on OPFS. Legacy v1 `MicroSaveOS_DB` is immutable, extraction-only. Never rename it or write to it.
- Production boot is latched to canonical authority (`src/application/p04-d/production-boot.js`). Never switch it to `legacy` or unfreeze v1 writers; every experiment copy that did so produced work that does not apply to the real app.
- A blocked write shows a truthful message, never a fake success.
- The permanent navigation is locked to Home, Plan, Ask Rushd, Insights, Goals (Settings outside it). Momentum never rewards amounts, underspending, wealth, transaction count or app opens. AI writes only through typed proposals.
- Arabic and English are equal-quality launch languages; isolate numbers in RTL.

## Working with the founder

- Ask before consequential changes to visual direction, core interactions, navigation or scope; show a concrete, visible proposal. Routine technical choices are mine.
- Never push, deploy, publish or touch a Vercel project without explicit permission. Commit locally when authorized; stage explicit files.
- The founder judges motion and design in the running app on a phone, bluntly. Self-graded reports have never predicted their reaction.

## Commands and gotchas

- `npm run lint`, `npm run typecheck`, `npm test` (needs the git history: it verifies the P00 baseline), `npm run test:data`, `npm run test:pwa`, `npm run build`.
- Browser suites use the Playwright browsers bundled in `node_modules`: prefix them with `PLAYWRIGHT_BROWSERS_PATH=0`.
- Judge finance behaviour with `npm run build && npm run preview`. `npm run dev` lacks the SQLite worker assets, and so does a build with a custom `--outDir` (the `rushdWorkerAssets` plugin always writes to `dist/`); without the worker every write shows "Writes are currently blocked".
- Icons come from a 48-glyph Material Symbols subset. Adding an icon means adding it to `src/components/material-symbol-icons.json` and running `npm run font:subset` (Python with `scripts/font-subset-requirements.txt`); unknown names silently render as `category`.
- `artifacts/` (agent reports and evidence) is gitignored and exists only on this Mac.
- Motion work: use `.agents/skills/rushd-motion-lab/SKILL.md`.
