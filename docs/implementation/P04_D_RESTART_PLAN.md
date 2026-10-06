# P04-D compatibility-first execution plan

**Date:** 12 September 2026  
**Status:** ready for Task D1  
**Architecture:** `docs/implementation/P04_D_RESTART_ARCHITECTURE.md`

## Outcome

Integrate accepted P04-B/C storage, migration, and portability into the visible
product without replacing the established application. Keep
`createLegacyApplication` mounted, migrate behavior through feature ports, and
switch production finance authority only after the full compatibility latch
passes. Complete P04-A1/A3/A4/A7 integration evidence without starting P05.

## Task sequence

### D1: compatibility seam and regression lock

Refactor the application boundary to accept a typed `ShellFeaturePorts` set
while keeping the default production path byte-for-byte equivalent in behavior.
Add the authority latch, legacy port set, mutation-coverage inventory, and a
candidate-only injection seam. No v2 storage opens in the production path and
no visible design/navigation change occurs.

Blocking proof: `createLegacyApplication` remains mounted; expense add/reload,
all populated destinations, import/export access, debug characterization,
Arabic/English direction, and visual parity remain green. Candidate mode cannot
be activated from localStorage, URL, or ordinary production runtime input.

### D2: canonical host and preserved-shell PWA lifecycle

Assemble guest identity, active-storage selection, migration/open, command
gateway, cross-tab invalidation, lifecycle coordination, and PWA caching behind
the candidate latch. Reimplement useful mechanisms from the rejected candidate
only by understanding them; do not cherry-pick or restore its shell/views.

Blocking proof: isolated canonical candidate opens/writes/reloads offline with
zero remote requests; storage failure mounts the established shell with a
truthful write-blocked recovery state; update activation cannot cross another
tab's write/import/reset/migration; old binaries cannot keep writing.

### D3: Home, Add, and Transactions ports

Derive canonical selected-day/home/history view models and route Add through the
P03 command gateway. Preserve the current header, hero, day strip, cards, FAB,
modal composition, bilingual copy quality, and numeric isolation. Remove or
replace reward framing and mutable delete/edit behavior only where canonical
commands require it.

Blocking proof: synthetic migrated data renders without invented fields;
expense add commits once, appears after reload and in another tab, and a failed
commit produces no visible success. Corrections/reversals preserve history.

### D4: Plan, Insights, Goals, portability, and authority cutover

Move every remaining enabled overlapping mutation and read path behind canonical
ports. Keep later-phase Ask intent truthful without replacing populated working
screens. Route export/import/reset through P04-C with visible commit points and
recovery. Mechanically prove mutation ownership, then switch the build-time
production latch once. V1 becomes extraction-only.

Blocking proof: all enabled financial controls are canonical or visibly
disabled before mutation; populated permanent/legacy-compatible destinations
remain useful; v1 stays unchanged; import/export/reset and route persistence
work offline; full visual and browser compatibility gates pass.

### D5: integrated device and P04 closure evidence

Run the real Android, iPadOS/iOS Safari, and desktop matrix against the exact
integrated SHA. Freeze the supported VFS/per-platform choice only from physical
evidence. Reuse accepted A/B/C evidence at unchanged SHAs, run missing integrated
gates once, and close P04 only if A1-A7 and P04-M1 all pass. Do not start P05.

## Gate policy

Every task runs the smallest focused tests while developing. The task's final
handoff includes its relevant browser or data gate. One independent reviewer
owns the integrated high-risk gate at each authority/lifecycle cut. The Master
adjudicates packaged evidence and does not repeat product tests without a
specific reason.

The following are blocking whenever the corresponding behavior changes:

- `npm run test:browser`
- `npm run test:legacy-idb`
- `npm run parity:quick`
- `npm run test:data`
- `npm run test:pwa` once D2 creates it
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`

## Path boundary

The P04 phase path list now permits the exact existing host files and scoped
P04-D modules required for compatibility integration. It does not authorize a
new root shell, broad component rewrite, P05 design system, domain semantic
changes, accounts/sync, AI, publication, or destructive use of real data.

## Active dispatch

D1 is integrated at `f15900b`, D2 at `f193fdc`, and D3 at `877eb27`, after free
Muse Spark 1.3 High implementation and green Cursor Grok 4.6 reviews. Run
`docs/implementation/P04_D_TASK_D4_PROMPT.md` with Muse Spark 1.3 High through
OpenCode's free contributor route. D4 completes remaining ports and performs the
single reviewed production authority cutover while preserving the existing UI.
Grok 4.6 Medium/High remains the correction or independent-review route if the
candidate exposes a hard integration defect. A different model/provider or
expanded scope requires a new routing decision.
