# Codex-era Development Master rules (archived 6 October 2026)

These rules governed the GPT/Codex Development Master (Sol/Astra/Luna routing, external workers, unattended monitors). They were removed from `AGENTS.md` when the project moved to Claude Code. They are history, not current instructions; the delegation model for Claude Code is to be re-decided with the founder. See `docs/implementation/DEVELOPMENT_MASTER_HANDOFF.md`.

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
