# P04-A provisional storage ADR + feasibility evidence (Task A, corrected)

Date: 8 September 2026 (corrections 01–02 plus Grok competing-write and
leak-exit correction). Status: provisional — Task A feasibility only.
This is NOT the final VFS decision and NOT P04 acceptance. The final
choice freezes only after physical-device evidence
(Task E) on the founder's Samsung Galaxy A55 (first Android Chrome
target), iPad Pro M4 (first iPadOS Safari target), and Mac (first desktop
target). Windows is unavailable and is not a P04 requirement. iPhone/iOS
remains unconfirmed.

## 1. Pinned distribution (exact, verified from primary sources)

- Package: `@journeyapps/wa-sqlite@2.0.4` (exact pin, 0 dependencies),
  published 2026-09-03.
- Source: maintained PowerSync/JourneyApps fork
  `github.com/powersync-ja/wa-sqlite` of upstream
  `github.com/rhashimoto/wa-sqlite`.
- License: MIT (LICENSE file, upstream copyright 2023; README states MIT
  since 2023-02-10; the npm `license` field is empty).
- The unscoped `wa-sqlite@1.0.0` npm release is not official (upstream
  disavowal) and is not used; the earlier Task A note about it is
  superseded by this pin.
- Engine: `SELECT sqlite_version()` reports `3.53.0` on BOTH candidates
  (measured in Chromium 151, this experiment).
- Files used: `dist/wa-sqlite.mjs` + `wa-sqlite.wasm` (sync build, OPFS),
  `dist/wa-sqlite-async.mjs` + `wa-sqlite-async.wasm` (asyncify build,
  IDB), `src/sqlite-api.js`, `src/FacadeVFS.js`, `src/VFS.js`,
  `src/WebLocksMixin.js`, `src/examples/IDBBatchAtomicVFS.js`,
  `src/examples/OPFSCoopSyncVFS.js`, `src/types/index.d.ts`.
- Fork bundling hazard for Task B: the fork ships PowerSync Rust-core
  builds (`mc-*`, `*-dynamic-*`) and downloads dynamic WASM in a
  `postinstall` script. Offline bundling must vendor only the files above
  and never depend on network fetches at build time.
- VFS examples remain upstream proof-of-concept, not production-hardened
  storage: Task B hardens the adapter layer (timeouts, single-writer
  discipline, recovery) around them.

## 2. Provisional recommendation (executed backends only)

`result.provisionalDefault` in raw is `["opfs"]`: OPFS is the SOLE
provisional default. IDB is DEMOTED (status `FAILED-fault-gate`) after a
deterministic fault-gate failure reproduced across runs (see §3). No
unexecuted backend is recommended, and no failing backend stands as
default.

- Provisional default: `OPFSCoopSyncVFS` (sync build, dedicated Worker —
  sync access handles require it). A second BEGIN resolves immediately
  (measured cooperative behavior); conflicts surface at guard/commit
  time. Filesystem transparent. A second independent instance cannot open
  the file while the first holds an access handle
  (`NoModificationAllowedError` from `createSyncAccessHandle`, measured
  loud failure — never silent). That overlap refusal is accepted only
  when the holder then commits a real revision-guarded write and the
  loser retries the same starting revision; any other open/permission/
  runtime error fails the experiment. If both instances open, both must
  attempt a revision-guarded write from the same starting revision
  behind an explicit barrier, with exactly one durable commit and one
  explicit loser (BUSY, stale revision, or guard conflict).
- Demoted: `IDBBatchAtomicVFS` (asyncify build, any context; dedicated
  Worker in Task A). Concurrent writers serialize by BLOCKING
  (measured: second BEGIN still pending after 3 s; `lockTimeout` defaults
  to Infinity). A controlled `jSync` → `SQLITE_IOERR_FSYNC` injection
  (fired exactly once per trial, `10:disk I/O error` surfaced) still
  leaves all 30 fault rows durable (`50→80`, leaked 30, integrity ok) —
  committed despite injected sync failure. An isolated fault-probe child
  is bound to the parent by a unique run token and unique output path;
  the parent accepts only a newly created payload with that token,
  schema `p04a-idb-fault-probe` v1, and start/completion timestamps.
  The fixed `idb-fault-probe.json` path is never acceptance evidence.
  The probe process must exit status `1` on leaked rows; any other child
  status fails the parent. The parent is green only when that exact leak
  classification is proven (fault string exactly `10:disk I/O error`, not
  a prefix) and OPFS leaked zero rows under the same exact classification
  plus `jSync-IOERR_FSYNC` / `50→50`. Task B must not reinstate IDB without a
  passing controlled fault trial.

Plain IndexedDB objects are rejected as an undocumented replacement for
the master plan's SQLite-compatible requirement and are not benchmarked.

## 3. Measured evidence (Chromium 151.0.7922.34, darwin/arm64, Node v26.8.1)

Raw: `artifacts/agent-reports/p04a-raw/candidate-experiment.json` plus
timestamped per-run copies (`candidate-experiment-<ISO>.json`; three
consecutive green `npm run test:data` runs recorded).
Command: `npm run test:data` (vitest + this experiment). The experiment FAILS loudly on any unexecuted required scenario or unexpected outcome. IDB's leak is proven by an isolated fault-probe child bound by a unique run token and unique output path; the parent is green only when that newly created payload matches the exact expected leak classification and OPFS leaked zero rows under the closed `jSync` classification (`method`, fire count `1`, `10:disk I/O error`, `50→50`). A FAILED fault gate demotes that candidate out of the provisional default (loudly recorded, never relaxed). Sizes: small 50
rows, larger 2,000 rows; 5 cold + 5 warm reps per candidate per size; 20
single-row atomic commits per rep. Cross-candidate deterministic checksums
match exactly (small 340467, large 9202542).

| Scenario | IDB candidate | OPFS candidate |
| --- | --- | --- |
| Engine | 3.53.0 | 3.53.0 |
| Bulk 50 rows, median | 2.0 ms cold / 1.3 ms warm | 2.4 ms cold / 1.8 ms warm |
| Bulk 2,000 rows, median | 13.4 ms cold / 7.5 ms warm | 11.1 ms cold / 7.6 ms warm |
| Single atomic commit, median | ~1.1 ms cold / ~0.9 ms warm | ~1.7 ms both |
| Readback | ~1.3 ms | ~0.5 ms |
| Reload (close/reopen, 70 rows) | preserved, 2.5 ms | preserved, 1.9 ms |
| Concurrent writers | 2nd BEGIN blocked ≥3 s | 2nd BEGIN resolved early (cooperative) |
| True two-tab competing guarded writes (independent pages/workers/VFS, same starting revision, explicit barrier, fresh-page reopen) | Both attempt revision-7 guarded writes; exactly one durable commit and one explicit loser (BUSY/stale/guard-conflict); reopen rev 8, winner ×1, loser row absent, stale loser rolls back | Either both open and reach the same guarded-conflict proof, or overlapped open is refused with measured `NoModificationAllowedError` from `createSyncAccessHandle`, holder commits a real guarded write, loser retries revision 7 and loses; reopen identical |
| Blocked-writer termination + reopen | uncommitted row absent, integrity ok | same |
| Stale guarded write (sequential) | 0 rows changed → rollback; revision 8, winner intact | same |
| Storage-boundary fault (controlled one-shot `jSync` → `SQLITE_IOERR_FSYNC`, fired ×1, seeded 50-row base, fresh-connection verify ×3 trials) | **FAILED 3/3**: `10:disk I/O error` surfaced, yet all 30 fault rows durable (`50→80`, leaked 30, integrity ok) — committed despite injected sync failure; unique-token probe exits nonzero | **pass 3/3**: method `jSync-IOERR_FSYNC`, fired 1, `10:disk I/O error`, `50→50`, leaked 0, integrity ok |
| Parked-tx worker termination + reopen | parked row absent, integrity ok | same |
| P03 overlay proof (full envelope: 12/12 fields vs journal+receipt; delivery v1/a1 with outbox linkage) | n/a (one candidate suffices) | 5 receipts, 3 inflows, 5 outbox intents, digest identical after close/reopen |
| Quota context | 3.2 GiB estimate | 4.3 GiB estimate (physical exhaustion not attempted) |

Two honest technique notes, both recorded in raw: (a) the `jSync`
error-code fault (VFS convention, numeric return) replaced the earlier
`jWrite`-throw fault whose bridge translation was nondeterministic
(async-throw → "unexpected Promise" rejection; sync-throw → clean once,
leaked once on rerun — the Master's reproduced defect); (b) the poisoned
post-fault connection aborts later statements ("query aborted"), so
verification runs on a FRESH connection after a worker restart — the same
reopen a real adapter must perform after an I/O error. A metric fix is
also recorded: fault-trial seed rows were renamed `seedbase-*` after the
`fault-seed-*` names were found to match the `LIKE 'fault-%'` leak
metric; OPFS "leaked 50" in the pre-fix run was pure seed pollution
(`after` still equaled `before`), post-fix OPFS leaks read exactly 0.

## 4. Repository integration shape (proven on the OPFS candidate)

P03's port (`runTransaction` async, `tx` methods sync) is backed by
`src/data/experiments/sqlite-candidate-repository.ts`:

1. Async hydrate (SELECTs) + sync preview cache (`open()`/`refresh()`; a
   stale preview fails as `revisionConflict` per the P03 protocol).
2. Synchronous overlay staging in the body (isolation,
   read-your-own-write).
3. Fresh guard recheck (book revision, operation/outbox uniqueness,
   delivery version, enqueue sequence) plus the complete delta inside ONE
   SQLite transaction (`BEGIN IMMEDIATE` … `COMMIT`, `ROLLBACK` on any
   failure). No whole-store restore: a concurrent winner is never erased.
4. `tests/data/worker-command-entry.ts` (esbuild-bundled real production
   commands) ran createBook + openCycle + 3 recordInflows on the OPFS
   candidate, compared all 12 outbox envelope fields against the matching
   journal record, receipt, and context (14 comparisons), recorded one
   delivery attempt from the complete envelope (version 1, attempts 1,
   outboxId-linked), and close/reopen returned the byte-identical digest
   over books, journal, outbox, delivery, and sequence.

The retired file-backed proof (TOCTOU race in fresh-read/check/write,
fail-open reads) is deleted, not retained. The poisoned-connection lesson
above is folded into the Task B design: reopen clean connections after
I/O errors; never verify on a faulted handle.

## 5. Conformance integration (Task B adopts, not copies)

The synchronous fixture (`tests/domain/support/repository-conformance.ts`)
and `reopen()` stay behavior-identical. The persistent adapter runs them
through a minimal async test-lifecycle adaptation: async
`createAdapter(scope)`, async `reopen()`, awaited runner; every behavioral
assertion preserved. In-memory conformance is never cited as persistent
proof; Task B reruns the suite against the real adapter plus
reload/multi-tab/quota/device scenarios. No P03 assertion or domain
contract was altered in Task A.

## 6. Physical-device test card (Task E; founder hardware recorded)

Targets: Samsung Galaxy A55 (Android Chrome), iPad Pro M4 (iPadOS
Safari), Mac (desktop Safari/Chrome). iPhone/iOS unconfirmed; Windows out
of scope. None of these devices was tested in Task A — the card is
pending until the founder physically performs it and supplies evidence.
Per target record hardware/OS/browser/installed-vs-tab/build/SHA, then:
cold installed launch, offline reload + write, two-tab competing writes,
kill-during-write + reopen, quota/private-mode truthful error, migration
round-trip, update with old/new tabs, rollback open of newer schema.
Acceptance: all pass with sanitized evidence, or an explicitly tested
per-platform adapter (or truthful unsupported path) — never a silent
fallback. Emulation (Playwright WebKit included) satisfies nothing here.

## 7. Proposed tooling amendments (for Task B, NOT applied here)

Task A may not touch tooling outside its path list:

1. Extend `vitest.config.ts` include (or keep the scoped
   `tests/data/vitest.p04a.config.ts` as the permanent `test:data`
   runner), `tsconfig.json` include (cover `tests/data/**/*.ts`), and the
   `npm run lint` file list (cover `src/data/**`, `tests/data/**`) so
   every new module and test is discovery-checked. (Task A linted all
   changed paths directly: clean.)
2. Resolve the Playwright browser path: Task A used the default
   `~/Library/Caches/ms-playwright` cache (repo scripts assume
   `PLAYWRIGHT_BROWSERS_PATH=0` with a local install absent here).
3. The `node-fs-shim.d.ts` workaround is already deleted with the retired
   file proof; no replacement needed.

## 8. Raw evidence paths

- `artifacts/agent-reports/p04a-raw/candidate-experiment.json` (latest
  full matrix, environment, medians, exact errors, classification,
  untested list) plus timestamped copies per gate run
  (`candidate-experiment-<ISO>.json`).
- `artifacts/agent-reports/p04a-raw/command-entry.bundle.mjs`
  (regenerated each run by esbuild from `tests/data/worker-command-entry.ts`).
- `artifacts/agent-reports/p04a-raw/idb-fault-probe-run-<token>.json`
  plus a timestamped copy after parent validation
  (`idb-fault-probe-<ISO>.json`). Isolated IDB leak probe bound to that
  run token; the process exits nonzero on any leaked rows. The fixed
  `idb-fault-probe.json` path is not acceptance evidence.
- Prior-superseded raw (`browser-experiment.json`,
  `file-adapter-benchmark-*.json`) remains on disk as history but backs no
  claim in this document.
