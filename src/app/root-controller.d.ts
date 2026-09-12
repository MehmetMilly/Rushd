// P02 declaration boundary for the mechanically moved legacy controller.
// P05/P06 owns typed controller and route design.
// The optional fourth parameter is the P04-D1 injection seam: an explicit
// feature-port set exposed read-only with zero behavior change.
export function installRootController(app: import('vue').App, dataRuntime: unknown, environment?: typeof globalThis, options?: { featurePorts?: unknown }): void;
