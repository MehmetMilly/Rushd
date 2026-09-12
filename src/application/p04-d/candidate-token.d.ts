// P04-D2 declaration boundary for the host-bound candidate-port marker.
// Runtime lives in `./candidate-token.js` and has no imports.

export function markCandidatePorts<TPorts extends object>(ports: TPorts): TPorts;
export function isMarkedCandidatePorts(ports: unknown): boolean;
