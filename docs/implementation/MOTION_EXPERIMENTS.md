# Rushd motion experiments (24 Sep – 2 Oct 2026)

Reference for P05/P11 design and motion work. Between the P04 phone checkpoint and the Claude handoff, the founder ran several side experiments asking different models for "crazy" animations in disposable copies of the app. None of them is merged, and none is mergeable as-is. Their value is (1) the founder's recorded reactions, which are the best available evidence of their taste, and (2) a few concepts worth re-deriving properly in the real app.

Audited on 6 October 2026 by diffing every copy against the main checkout. All copies started from the same source: the main checkout's working tree as of 24 September (base `9a3267b` plus the then-uncommitted P04 work, which is what the 6 October checkpoint commit contains). The Gemini baseline tarball's `src/`, `public/` and `index.html` are byte-identical to that tree.

## The trap every copy shares

Every copy that does real motion work **does not run the production finance runtime**:

- `Muse Rushd`, `Astra Rushd`, `Sol Rushd` edit `src/application/p04-d/production-boot.js` to boot `authorityMode: 'legacy'` with v1 writers unfrozen ("EXPERIMENT COPY ONLY — full-unlock playground").
- `Rushd-motion/sandbox` (Gemini) replaces the boot with `src/application/motion-sandbox-boot.js`, a legacy v1 demo runtime on a separate IndexedDB name.

They did this because the canonical production app visibly blocks several legacy features (allowance save, profiles, template/goal delete; see the handoff's product-reality section). Consequences:

- Motion built there may target controls and states that do not exist or are disabled in production.
- Their test claims ("finance files byte-identical", "205 tests pass") prove the finance code was untouched, not that the motion works against the canonical runtime.
- Never copy their `production-boot.js`, `main.ts` boot changes, or `motion-sandbox-boot.js` into the main checkout. Port ideas, not files.

## The copies

| Copy | Who | What it is | Status |
| --- | --- | --- | --- |
| `/Users/mehmet/Desktop/Rushd-motion/sandbox` | Gemini 3.8 Flash (Antigravity), ~25–26 Sep | Whole-app motion pass: liquid nav pill, FAB "fluid morph" into capture sheet, ink-stamp + balance recoil on save/pay, goal "haptic dial" + confetti, ledger swipe hint, donut sweep, a 15-variant "Motion Mixer". Patch: `docs/rushd-motion.patch`; trailer: `docs/trailer/rushd-motion-trailer.webm`. Run: `npm run build && npm run preview` (port 5137). | Self-graded "SHIP — MASTERWORK CERTIFIED" in `CRITIC.md`/`MERGE_REPORT.md`; disregard those grades. Founder verdict below. ~5.3k changed CSS lines, ~1.4k controller lines. |
| `/Users/mehmet/Desktop/Rushd-motion/preview-fixes` | Codex helper | Throwaway copy of an earlier Gemini wave with critic fixes applied, for tasting. Its own README says not for merging. | Ignore. |
| `/Users/mehmet/Desktop/Rushd-motion/` (top level) | Codex (Sol) | The mission brief Gemini ran under (`task-rushd.md`), `RESUME.md` with the founder's tasting notes, `REFERENCES.md` (awe-bar links), baseline tarball. | Useful for the founder's notes. |
| `/Users/mehmet/Desktop/Rushd-motion 0/` | Codex (Sol/Astra) | Earlier brief drafts (`ASTRA_BRIEF.md`) and the Codex session root for the Astra/Sol attempts. | History only. |
| `/Users/mehmet/Desktop/Muse Rushd` | Muse Spark 1.3 | Same app plus one WebGL-ish "living balance" animation on the safe-to-spend card (`src/motion/living-balance.*`), legacy runtime unlocked. | Founder: "turned out pretty meh". Later explicitly scrapped. |
| `/Users/mehmet/Desktop/Astra Rushd` | GPT-6 Astra, 27–28 Sep | On top of Muse: balance "materials" (Nacre etc.), nav (Depth, Fold, Shear), capture (Pressure, Fan), vault "iris", mixer. Patch `ASTRA_CHANGES.patch`, notes `ASTRA_README.md`. Port 5143. | Founder rejected it ("jesus fucking christ… we're clearly not aligned"). |
| `/Users/mehmet/Desktop/Sol Rushd` | GPT-6.1 Sol, 30 Sep – 2 Oct | Rebuilt on Muse after Astra's rejection: `src/motion/sol/*` (nav frame/gate/orbit, capture "Fold"/record carry, day "concertina", goal "Cuff", plan "Loom", payment, dialogs, sound engine), standalone labs in `labs/`, ~40 process docs in `docs/sol-motion/` (`STATUS.md` is the summary). Final "one last shot": the **expense-knot** save animation (form gathers into a WebGL2 satin ribbon knot, unfolds into the real ledger row; `docs/sol-motion/ONE-LAST-SHOT-HANDOFF.md`, recording `docs/sol-motion/expense-knot.webm`). Port 5146, `?preview=expense-knot`. | Broad pass rejected by founder (details below). Expense-knot: founder asked to host it (`https://rushd-expense-knot.vercel.app/?preview=expense-knot`, separate Vercel project); no recorded verdict beyond that. |
| `/Users/mehmet/Desktop/Opus Rushd` | none yet | Clean copy made 25 Sep for a Claude Opus experiment. `src/` is byte-identical to the main checkout's 24 Sep tree. No work done in it. | Untouched. |
| `/Users/mehmet/Desktop/Rushd-Personal-Alpha` | Gemini, 13 Sep | Separate git repo deploying commit `82d3262` (D4) to `https://rushd-personal-alpha.vercel.app` for the founder's temporary personal use, plus an unrelated `Tide-boosted/` folder. | Superseded by later P04 fixes. Founder confirmed (6 Oct) no data they care about lives in any deployment. |

## Founder verdicts, quoted where it matters

These are the calibration points. Quotes are the founder's own words. Re-read them before judging any motion.

**Gemini sandbox** (founder, 27 Sep): first round "pretty meh… really basic animations (they would be considered good by most people but MUCH below my standards)"; after a harsh re-prompt it produced "acceptable results". The founder **liked the tab-switching animation** ("not too bad but… feels wrong" at first; later "creative… actually genuinely fun to watch, it felt good", rated ≈8.2/10) and thought the **Goals animation was "pretty cool in concept… FINALLY tried something new and unique, but really rough."** The add animation was "completely glitched". The founder's tasting notes in `Rushd-motion/RESUME.md`: take the tab pill to an *extreme*, the FAB morph was "just a fade" (the founder wanted the button boundary to stretch into the sheet, no teleport), the add-expense recoil was invisible, goals untestable without seeded data, and a hidden swipe gesture is a failed gesture.

**Astra** (30 Sep): rejected the whole delivery. Restated failure: it built ornaments (balance sculpture, iris, mixer) and presented verification as success.

**Sol broad pass** (30 Sep, on build `DAiTS2tR`): nav "Frame" = "such a simple, stupid looking… zoom in"; "Gate"/door nav "better… still a bit too simple" and not as good as Gemini's; add-expense "not bad… not particularly impressed… doesn't feel polished"; the in-modal field-to-field motion "a bit unique and actually a bit better made" but the **resting form design was unpolished / changed too much**; day-change animations "absolutely ass… almost does nothing"; goal **Cuff** "feels unique, could be genuinely crazy, but needs a lot more polish", other goal variants hopeless; plan **Loom** "one of the better ones… has some potential", other plan variant bad. Overall "extremely disappointed".

**Sol one-shot expense-knot** (1–2 Oct): the founder asked for "one single crazy animation… absolutely gorgeous, very crazy… extremely polished, novel". After seeing it the founder asked to host it on Vercel. Treat it as the most-accepted artifact so far, not as approved.

## What the founder means by "crazy animation"

Synthesised from the founder's briefs (full text in the Codex sessions; key brief preserved in `Rushd-motion/task-rushd.md` and the Astra prompt quoted in `Rushd-motion 0/ASTRA_BRIEF.md`):

- The bar is **iOS device interactions and game UI** (Dynamic Island absorbing an app, Siri orb, iOS sheets, game reward ceremonies), not Apple *websites* or typical web scroll animations. Principles, not widgets: no fake island or orb in a finance app.
- **Wild invention and immaculate execution at the same time.** A novel idea rendered roughly fails; a polished but familiar fade/scale/spring fails. More particles, bounce or glow is not more imagination.
- **Every action** gets an authored response; some become big signature moments. A few hero effects surrounded by generic interactions does not satisfy the founder.
- **Continuity of identity**: objects travel and transform (the record the user typed becomes the ledger row), never teleport or swap for a copy. Ghost copies beside originals read as glitches.
- **Motion with a visible cause**: the spectacle comes from what you press, drag, open or confirm. Decorative motion on a static surface (the balance-card renderers) was rejected repeatedly.
- **Game-like reward** fits the youth audience, but celebrations reward *actions* (logging, reviewing), never money amounts, underspending or wealth (Momentum rule).
- The founder's test: "Would I replay this interaction just to understand what happened, and does it still feel excellent when I control it fast?" The founder wants things they can "flex" by handing someone the phone.
- The founder keeps good alternatives to mix and match, and wants to see variants, but "none" is an acceptable outcome for a batch.
- The founder reacts strongly and bluntly; strong negative feedback is information about the work, not a cue to add more effects. Several agents failed by responding to criticism with more mechanisms and more verification reports instead of better ideas and better craft.

## Lessons for doing this in the real app

1. Judge in motion, at normal speed, in the real app, in Arabic first. Frame-perfect test reports and model-graded scores did not predict the founder's reaction once.
2. Show the founder a small number of genuinely different, finished-looking directions early, connected to a real journey (capture → commit → ledger), before polishing breadth.
3. The resting design matters as much as the motion; the founder rejected motion whose static state looked rough or departed from the established identity.
4. Build on the production canonical runtime. If a flow is blocked there (allowance, profiles, deletes), that is P06 product work to do first or alongside, not a reason to switch the runtime.
5. The master plan's Motion Lab gates (six prototypes, Full/Balanced/Reduced, 0–4 rubric, interruption, a11y, perf) still bind P05 acceptance. The founder's taste sets the creative bar; the gates set the floor.
