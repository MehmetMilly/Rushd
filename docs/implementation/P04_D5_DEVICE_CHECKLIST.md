# P04-D5 physical-device checklist

**Physical-test target:** stable isolated origin
`https://rushd-p04d5-device-gate.vercel.app/`, deployment
`dpl_2PKp8cCzPNN3YmK7Vizp4zgTzJzC`, independently inspected after the v4
preview promotion. Gate report: `artifacts/agent-reports/P04-FONT-V4-ISOLATED-GATE.md`.
This deployment is a built artifact, not a Git SHA. The committed base remains
`9a3267bda30919fb9c85f98357d5b194ea2bdbef` plus uncommitted changes.
The current stable origin was independently fetched and matched local `dist`:
`index.html` `5ba90c12eb07402cbf4da59b5afed884e7e6031820f2d8c1d8272ebe8580f764`,
JS `/assets/index-CPeO-cuI.js`
`3bf31e50f6bdfb91da29dbe96052761c3ac18bb64fabc1f0f3a23cf59b160348`, CSS
`/assets/index-RBz2T2Xl.css`
`79ae3457195d585610b03f2be945e868ddcffd03ddb763301fdd6a9d997e1ed0`, service
worker `/rushd-pwa-sw.js`
`c89e9d435ee6ffd9e54beb221b2fd1323a5dd39e356b71b8f6b36ea363e307b1`,
and 49,892-byte icon font `d24dd74877cca4c320accdcdd2b6fe565f2986ca2eebf0495bf5a953799397ae`.
`3c7763a` is historical only; its local-preview instructions are obsolete.
Fake data only; no real or personal financial data, no dogfood or publication.

The founder deferred the physical iPadOS pass. Record it as **NOT_TESTED**;
do not infer iPad behavior from iPhone. Use one short fake-data iPhone/Android
private-use pass rather than the unsafe quota/private-mode/kill-write probes.

**Status key:** `pending` = not executed (never passed). `done` = executed
with evidence path recorded.

## A. Android — Samsung Galaxy A55, Chrome (pending)

Prereq: USB cable, USB debugging on the phone, `adb` on the Mac.

- [x] **done** A1. `adb devices -l` found `SM-A556E`, Android 16, Chrome 153.0.8010.52.
- [x] **done** A2. Current stable isolated origin loaded `/assets/index-CPeO-cuI.js` under `rushd-pwa-v4`; exact asset identity is in the isolated gate report.
- [x] **done** A3. Chrome mounted the current app with the subset icon font.
- [x] **done** A4. Existing clearly fake `A55 Legacy 422` survived the v2-to-v4 upgrade; two more explicitly fake SAR 0.01/0.02 rows were added.
- [ ] **pending** A5. Install: Chrome menu → Install/Add to Home screen; cold launch from the icon.
- [x] **done with limitation** A6. Target-scoped Chrome DevTools offline emulation, not Airplane Mode: reload/read, SAR 0.01 write, offline reopen, and online restoration passed while the hotspot stayed on. Physical radio-offline remains NOT_TESTED.
- [x] **done** A7. Second Chrome tab saw both rows, saved a fake SAR 0.02 row, and the first tab showed it exactly once after reload.
- [x] **partial** A8. Old v2 tab discovered waiting v4; after leaving the old tab, v4 activated and preserved the fake row. Old-tab write rejection was NOT_TESTED.
- [ ] **pending** A9. Persistence: force-stop Chrome, relaunch → rows and device id intact.
- [ ] **pending** A10. Backup/restore: manual Export Backup saves the file; Factory Reset creates no export/share/download and empties the scope; re-import restores rows; device id remains unchanged.
- [ ] **pending** A11. VFS crash recovery: with clearly fake data in the isolated origin, interrupt one staged write through a controlled test harness, reopen, and verify that either the full write or no write persisted. Do not force-stop a real-data session or call an ordinary app restart a kill-during-write test; mark **NOT_TESTED** if no safe harness exists.
- [ ] **pending** A12. Quota/private-mode behavior: use only a disposable test scope to verify a truthful storage error and no silent memory fallback. Do not exhaust the phone's storage or clear personal browser data; mark **NOT_TESTED** if the failure cannot be induced safely.
- [ ] **pending** A13. Newer-schema rollback: open a disposable newer-schema test database with the older client, require visible rejection without mutation, then verify recovery with the matching newer client. Do not introduce a newer schema on the stable origin or personal data merely for this gate; mark **NOT_TESTED** until a controlled artifact exists.
- [ ] **pending** A14. Cleanup: uninstall only the test install and clear only its disposable site data if requested.
- [ ] **pending** A15. Evidence saved: attested device model, Android + Chrome versions, deployment ID/origin, pass/fail or **NOT_TESTED** per row, screenshots, and evidence paths.

## B. iPadOS Safari — iPad Pro M4 (deferred, NOT_TESTED)

- [ ] **pending** B1. Physical iPad available (desktop WebKit/responsive mode is NOT evidence).
- [ ] **pending** B2. Open the exact stable isolated HTTPS origin and deployment named above in iPadOS Safari; record the deployment ID and confirm it matches the checklist target. Mac Safari or responsive emulation is not a substitute for physical iPadOS evidence.
- [ ] **pending** B3–B8. Same coverage as A5–A15 on iPadOS Safari (install, offline, write, reload, two-tab, update/old-tab, reset, backup/restore, VFS failure paths), fake data only and the same no-personal-data safeguards.

## C. iOS Safari — iPhone (founder-reported partial pass)

- [x] **founder-reported** C1. On the current v4 isolated deployment, installed online reopen, icon rendering, fake-data offline read/write/reopen, persistence, separate manual export, no-export Factory Reset, and restore each passed. Evidence: `artifacts/agent-reports/P04-D5-IPHONE-V4-FOUNDER-REPORT.md`.
- [ ] **NOT_TESTED on this build** C2. iPhone model/OS attestation, import cancel/invalid-file rejection, two-tab behavior, and controlled old-tab update rejection. Do not infer these from the founder's shorter script or older deployment reports.

## D. Desktop Mac — Safari + Chrome (partial)

- [x] **done (historical; reset contract superseded)** D1. Chromium 390×844 bounded probe on `82d3262`: 14/14 (boot canonicalReady, UI write, two-tab, reload persistence, offline reload, the then-current export-first reset, safety re-import, zero remote/errors). Active A12 now requires manual export plus a no-export Factory Reset. Probe: temp `d5-prep-probe.mjs` (outside repo); backup: temp `d5-prep-safety-backup.json`.
- [ ] **pending** D2. Desktop Safari pass of the same bounded probe (needs a Safari WebDriver run; not claimed by the Chromium result).
- [ ] **pending** D3. Reused, not rerun: full D4 gate (45 checks, `p04-d4-browser.mjs`), lint/typecheck/`npm test`/`test:data`/`test:pwa`/parity self-test — green at `82d3262` per `artifacts/agent-reports/P04-D4.md`.

## Out of scope

Windows (not a P04 requirement), real data, account/sync, AI, P04 closure claims.
