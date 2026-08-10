---
name: rushd-motion-lab
description: Prototype, implement, measure, and verify Rushd's signature motion language. Use for Rushd P05 or P11, Motion Lab prototypes, animated navigation or shared elements, capture/confirmation choreography, Momentum visuals, Full/Balanced/Reduced motion profiles, animation performance regressions, or motion accessibility and interruption testing.
---

# Rushd Motion Lab

Build motion that is unusually expressive and still behaves like reliable product
infrastructure. A beautiful recording is not a pass unless rapid input, errors, offline
changes, reduced motion, accessibility, and measured target-device performance also pass.

## Load authority

Read these before editing:

1. `AGENTS.md`
2. Motion and performance sections in `docs/RUSHD_MASTER_PLAN_FINAL.md`
3. Exact P05 or P11 record in `docs/implementation/phase-plan.json`
4. Relevant design decision and existing motion-token files

Use the installed `frontend-design` skill as a companion for art direction and visual
distinctiveness. This skill owns motion semantics, engineering, measurement, and evidence.

## Choose the work mode

- **P05 laboratory:** keep each candidate isolated. Compare alternatives, record all three
  profiles, select or reject explicitly, and do not spread motion across the app yet.
- **P11 application:** use only P05-approved tokens/patterns. Apply them coherently across
  complete flows and re-test cross-screen interruption, cleanup, and realistic performance.
- **Regression diagnosis:** reproduce the exact state/input/device profile, capture a trace,
  isolate the property or engine causing the miss, then make the smallest correction.

## Run the prototype loop

For each of the six canonical prototypes:

1. **Define meaning.** Write the before/after state, user intent, accessible announcement,
   failure state, cancellation behavior, and what must remain immediately interactive.
2. **Storyboard.** Specify 3–6 intentional beats, hierarchy, duration ranges, easing family,
   spatial direction for RTL/LTR, sound/haptic assumptions, and a Reduced equivalent. Never
   animate merely to fill time.
3. **Implement one owner per property.** Prefer CSS/Vue transition tokens and
   transform/opacity. Use WAAPI for small interruptible imperative sequences, selectively
   lazy-load `motion-v` for justified gesture/layout work, and treat View Transitions as
   progressive enhancement. GSAP or Rive requires the exception proof in the master plan.
4. **Attack behavior.** Test rapid repeat taps, reversal, navigation interruption, hidden
   tab, route teardown, error after optimistic UI, offline transition, stale response,
   keyboard/screen-reader operation, 400% zoom, and OS reduced motion. The final financial
   state must be identical with animation disabled.
5. **Measure.** Retain browser traces, long-task and layout/paint evidence, memory before/
   after repeated cycles, bundle/lazy-load effect, screenshots, and Full/Balanced/Reduced
   recordings. Diagnose real frame-budget misses; do not infer quality from device names,
   user agent, or core count.
6. **Decide.** Mark the candidate `selected`, `revise`, or `rejected`, with a concise reason
   tied to clarity, character, accessibility, and measured performance.

Use the frozen 0–4 rubric in the master plan. Both the implementer and a fresh independent
visual reviewer score state-change clarity, Rushd distinctiveness, delight, continuity,
responsiveness, bilingual composition, and finish. Selection requires every dimension at
least 3, distinctiveness and delight at 4, and no failed behavioral, accessibility, or
performance gate. Preserve each score and its cited evidence; do not average away a low
dimension or substitute generic aesthetic praise.

The six required prototypes are:

1. Add-button morph and capture sheet.
2. Voice/text becoming structured expense cards.
3. Confirmation flowing into the daily ledger and availability answer.
4. Home-to-detail shared-element transition.
5. Plan diff and reconciliation.
6. Goal allocation and Momentum journey.

## Preserve the runtime contract

- Full is the non-reduced default and carries the complete signature choreography.
- Balanced preserves personality and hierarchy with less simultaneous/decorative work.
- OS reduced motion always forces Reduced. Reduced removes spatial, scale, rolling,
  parallax, confetti, and ambient motion while preserving immediate state/focus feedback.
- A measured repeated miss may trigger an explained recommendation for Balanced; it never
  silently changes the saved profile.
- Motion never delays a write, swallows input, hides a failure, changes calculation order,
  or becomes the only carrier of status or meaning.
- Avoid `transition: all`, permanent render loops, unprofiled blur/shadow/layout animation,
  and two engines controlling the same property.
- Clean up observers, timers, animation handles, temporary layers, object URLs, and listeners
  on completion, cancellation, and teardown.

## Retain evidence

Keep stable design decisions under `docs/design/motion-lab/` and run-specific raw evidence
under the declared `.codex/runs/<run-id>/evidence/<phase>/` root. For every prototype retain:

- Candidate ID and selected/rejected status.
- State/interaction contract and RTL/LTR notes.
- Token and engine/property ownership.
- Full/Balanced/Reduced PNG plus WebM/MP4 evidence.
- Automated interaction/a11y results and trace/log paths.
- Physical device, OS, browser/app mode, refresh rate when known, and limitations.
- Measured result and unresolved risk.

Use fake/sanitized financial data only. Automated emulation is useful evidence but never
claim it proves installed iOS/iPadOS PWA behavior or physical target performance.

## Stop rule

Do not call a candidate approved while a required profile, interruption path, accessibility
state, trace, or physical-device attestation is missing. Optional visual polish may remain
non-blocking only after the exact phase contract passes.
