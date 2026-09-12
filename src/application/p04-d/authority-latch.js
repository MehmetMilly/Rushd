// P04-D1: build/test-controlled authority latch.
//
// The latch answers one question: which finance authority may serve writes?
// In D1 the answer is always `legacy` on every ordinary production path.
// A `canonicalCandidate` mode exists as a structural concept so D2-D4 have a
// typed injection point, but D1 has no canonical port implementation and
// never opens v2 storage, so candidate requests resolve to a blocked
// `canonicalPreparing` state while behavior stays on the legacy port set.
//
// Injection rule (blocking): the candidate mode is reachable ONLY through an
// explicit request object passed directly by the test/build caller
// (`createLegacyApplication({ authorityMode, candidatePorts })`). This
// module performs no environment access of any kind, so no production
// runtime input (URL parameters, localStorage, cookies, imported user data,
// mutable global flags) can enable candidate mode. The accompanying test
// (`tests/application/p04-d-latch.test.mjs`) poisons every one of those
// channels and asserts the latch still resolves to `legacy`.
//
// Types live in `./contracts.js`; declarations are mirrored in
// `./authority-latch.d.ts` for checked consumers.

/**
 * @typedef {import('./contracts.js').AuthorityState} AuthorityState
 * @typedef {import('./contracts.js').P04DAuthorityRequest} P04DAuthorityRequest
 * @typedef {import('./contracts.js').P04DAuthorityResolution} P04DAuthorityResolution
 * @typedef {import('./contracts.js').P04DBuildMode} P04DBuildMode
 * @typedef {import('./contracts.js').ShellFeaturePorts} ShellFeaturePorts
 */

export const P04D_LEGACY_MODE = 'legacy';
export const P04D_CANDIDATE_MODE = 'canonicalCandidate';

/** D1 has no canonical port implementation; candidate work stays blocked. */
export const P04D_D1_CANDIDATE_BLOCKED_REASON =
  'P04-D1: canonical candidate ports are not implemented yet; production behavior stays on the legacy port set.';

/**
 * Normalize an explicit caller-supplied mode. Anything that is not the exact
 * `canonicalCandidate` string — including values smuggled in as objects,
 * arrays, or differently-cased strings — resolves to `legacy`.
 * @param {unknown} explicitMode
 * @returns {P04DBuildMode}
 */
export function normalizeP04DBuildMode(explicitMode) {
  return explicitMode === P04D_CANDIDATE_MODE ? P04D_CANDIDATE_MODE : P04D_LEGACY_MODE;
}

/**
 * Resolve the finance authority for this application instance.
 *
 * Reads ONLY `request` (explicit caller arguments) and `legacyPorts`. It
 * performs no environment access of any kind.
 * @param {P04DAuthorityRequest | null | undefined} request
 * @param {ShellFeaturePorts} legacyPorts
 * @returns {P04DAuthorityResolution}
 */
export function resolveP04DAuthority(request, legacyPorts) {
  const mode = normalizeP04DBuildMode(request?.mode);
  if (mode === P04D_CANDIDATE_MODE && request?.candidatePorts) {
    // Structural candidate path for D2-D4 harnesses: acknowledge the request
    // with a non-writable preparing state, but keep serving the legacy port
    // set so no v2 database, migration, or write path can open in D1.
    /** @type {AuthorityState} */
    const authority = {
      kind: 'canonicalPreparing',
      writable: false,
      reason: P04D_D1_CANDIDATE_BLOCKED_REASON,
    };
    return { mode, authority, featurePorts: legacyPorts };
  }
  /** @type {AuthorityState} */
  const authority = { kind: 'legacy', writable: true };
  return { mode: P04D_LEGACY_MODE, authority, featurePorts: legacyPorts };
}

/**
 * True only for writable authority states. D1 produces only `legacy`.
 * @param {AuthorityState} authority
 * @returns {boolean}
 */
export function isAuthorityWritable(authority) {
  return authority.writable === true;
}

/**
 * Human-readable one-line description for reports and blocked-action UI.
 * @param {AuthorityState} authority
 * @returns {string}
 */
export function describeAuthority(authority) {
  switch (authority.kind) {
    case 'legacy':
      return 'legacy (MicroSaveOS_DB v1 writable)';
    case 'canonicalPreparing':
      return `canonicalPreparing (blocked: ${authority.reason})`;
    case 'canonicalReady':
      return `canonicalReady (storage ${authority.storageId})`;
    case 'unavailable':
      return `unavailable (blocked: ${authority.reason})`;
    default:
      return 'unknown authority';
  }
}
