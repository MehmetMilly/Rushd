# P04-D5 physical-device checklist

**Product commit:** `3c7763a` (`codex/p04d-restart`). All pending physical rows
target that exact SHA. Fake data only; no real financial data, no P05, no publication.

**Status key:** `pending` = not executed (never passed). `done` = executed
with evidence path recorded.

## A. Android — Samsung Galaxy A55, Chrome (pending)

Prereq: USB cable, USB debugging on the phone, `adb` on the Mac.

- [ ] **pending** A1. `adb devices -l` lists the A55 (accept the on-phone RSA prompt if `unauthorized`).
- [ ] **pending** A2. `git rev-parse HEAD` is `3c7763a`; `npm run build` passes.
- [ ] **pending** A3. Serve: `npm run preview -- --host 127.0.0.1 --port 4173` (note the real port).
- [ ] **pending** A4. `adb reverse tcp:4173 tcp:4173`; verify with `adb reverse --list`.
- [ ] **pending** A5. Phone Chrome → `http://127.0.0.1:4173` boots with no error (localhost = secure context, no deploy/cert needed).
- [ ] **pending** A6. Seed fake data only (onboarding or clearly-fake import); record what was seeded.
- [ ] **pending** A7. Install: Chrome menu → Install/Add to Home screen; cold launch from the icon.
- [ ] **pending** A8. Offline reload: airplane mode → reload → shell mounts with committed rows; write while offline where supported, reconnect, rows intact.
- [ ] **pending** A9. Two-tab: second Chrome tab, same origin → same rows; commit in one, reload the other → visible.
- [ ] **pending** A10. Update/old-tab: rebuild + re-serve, reload one tab, old tab must refuse writes (no false success).
- [ ] **pending** A11. Persistence: force-stop Chrome, relaunch → rows and device id intact.
- [ ] **pending** A12. Backup/restore: manual Export Backup saves the file; Factory Reset creates no export/share/download and empties the scope; re-import restores rows; device id remains unchanged.
- [ ] **pending** A13. Cleanup: `adb reverse --remove tcp:4173`, stop the server, uninstall the test install, clear site data if requested.
- [ ] **pending** A14. Evidence saved: device model, Android + Chrome versions, pass/fail per row, screenshots.

## B. iPadOS Safari — iPad Pro M4 (pending, blocked)

- [ ] **pending** B1. Physical iPad available (desktop WebKit/responsive mode is NOT evidence).
- [ ] **pending** B2. Access route decided: same-LAN temporary HTTPS staging with a trusted cert, or another founder-approved route. Plain-HTTP LAN is not a secure context and cannot prove installed/offline behavior.
- [ ] **pending** B3–B8. Same coverage as A5–A12 on iPadOS Safari (install, offline, write, reload, two-tab, update/old-tab, reset, backup/restore), fake data only.

## C. iOS Safari — iPhone (pending, hardware unconfirmed)

- [ ] **pending** C1. Hardware confirmed; then same gate as section B.

## D. Desktop Mac — Safari + Chrome (partial)

- [x] **done (historical; reset contract superseded)** D1. Chromium 390×844 bounded probe on `82d3262`: 14/14 (boot canonicalReady, UI write, two-tab, reload persistence, offline reload, the then-current export-first reset, safety re-import, zero remote/errors). Active A12 now requires manual export plus a no-export Factory Reset. Probe: temp `d5-prep-probe.mjs` (outside repo); backup: temp `d5-prep-safety-backup.json`.
- [ ] **pending** D2. Desktop Safari pass of the same bounded probe (needs a Safari WebDriver run; not claimed by the Chromium result).
- [ ] **pending** D3. Reused, not rerun: full D4 gate (45 checks, `p04-d4-browser.mjs`), lint/typecheck/`npm test`/`test:data`/`test:pwa`/parity self-test — green at `82d3262` per `artifacts/agent-reports/P04-D4.md`.

## Out of scope

Windows (not a P04 requirement), real data, account/sync, AI, P05, P04 closure claims.
