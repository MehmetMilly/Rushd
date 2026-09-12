// P04-D2: unforgeable marker for host-bound canonical port sets.
//
// The authority latch must distinguish a canonical port set assembled by
// `prepareCanonicalCandidateHost` (real storage authority, gated writes)
// from an arbitrary object handed in through the test/build injection seam.
// This module is that distinction: marking lives in a module-level WeakSet
// that no runtime input channel (URL, storage, cookies, imported data,
// mutable globals) can reach, because marking requires a live reference to
// this module's `markCandidatePorts` function.
//
// The module is deliberately dependency-free: the latch can import it
// without opening storage, workers, or network paths, so the default
// production bundle stays legacy-authoritative.

const marked = new WeakSet();

/**
 * Mark a port set assembled by the canonical candidate host.
 * @param {object} ports Assembled canonical `ShellFeaturePorts`.
 * @returns {object} The same port set, for chaining.
 */
export function markCandidatePorts(ports) {
  if (ports && typeof ports === 'object') marked.add(ports);
  return ports;
}

/**
 * True only for port sets previously passed through `markCandidatePorts`
 * in this module instance.
 * @param {unknown} ports
 * @returns {boolean}
 */
export function isMarkedCandidatePorts(ports) {
  return !!ports && typeof ports === 'object' && marked.has(ports);
}
