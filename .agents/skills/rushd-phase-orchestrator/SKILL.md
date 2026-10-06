---
name: rushd-phase-orchestrator
description: Coordinate Rushd phase delivery, correction, verification, and closure using Workflow Lite and current founder routing preferences.
---

# Rushd phase orchestration

Read `WORKFLOW_LITE.md` and `docs/implementation/ACTIVE_DELIVERY_PLAN.md` at the repository root. They define the active operating rules and status. Read the relevant `phase-plan.json` entry and master-plan sections for acceptance; preserve `AGENTS.md` invariants.

For an ordinary task, choose the next authorized outcome, assign a capable economical owner, save a complete prompt/report interface, and apply proportional verification. Use Workflow Lite's routing and consultation rules. Keep independent verification for high-consequence changes.

After handing off work, do useful independent work if any remains. Otherwise end the Master turn with the actual return mechanism. Do not wait on or handhold a delegated worker, reviewer, or audit.

On completion, check the report, candidate identity, and relevant evidence. Reuse verified command results where allowed. Return precise blockers or integrate and record closure. Respect an explicit phase stop.

The scripts and templates in this skill directory support historical governed runs. Do not run their state transitions, receipts, automatic phase advancement, fixed model routing, or self-tests for ordinary Workflow Lite delivery. If the founder explicitly requests that historical mode, read `docs/RUSHD_EXECUTION_PROTOCOL.md` and only the required supporting files. Current founder permissions and routing still apply.
