# P00 immutable baseline

This directory freezes Rushd's pre-implementation authority, storage, defect, visual, motion, accessibility, and performance evidence at patch base `b56c80bc2e2eb103ebe5bc258bfeeea60accf53c`. All financial examples are synthetic.

## Contents

- `authority-baseline.json`: source, authority, protected-path hashes, and supersession log.
- `storage-inventory.json`: v1 IndexedDB/localStorage/export inventory and sanitized fixture hashes.
- `p0-p1-reproduction-results.json` and `p0-p1/`: exact 20-item P0/P1 catalog and stable per-ID final evidence.
- `visual-manifest.json`: SHA-256 inventory for the 12 language/theme/viewport combinations, native Playwright PNGs, WebM/MP4 recordings, error/loading states, and motion profiles.
- `accessibility-performance.json`: hashed state-level axe evidence and pinned-Chromium/0/100/1,000-record comparison measurements.
- `P00-manual-qa.json`: structured P00-M1 attestation with UTC and Riyadh local-time context.

Normal tests only verify these artifacts and never rewrite them. Evidence writers require explicit `RUSHD_BASELINE_WRITE=1`; replacing existing fixture, capture, encoded-motion, normalized-image, or packaged evidence also requires `RUSHD_BASELINE_REPLACE=1`. Known baseline defects are evidence for P01 and are not release-readiness claims.
