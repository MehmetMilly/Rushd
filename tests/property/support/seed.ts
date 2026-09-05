/**
 * Shared property-test configuration.
 *
 * Runs are deterministic: a fixed default seed per file, overridable through
 * RUSHD_PROPERTY_SEED so a reported counterexample can be replayed exactly.
 * Bounds are deliberately small; P03 avoids exhaustive random campaigns.
 */

export function propertySeed(fallback: number): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env?.['RUSHD_PROPERTY_SEED'];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export const PROPERTY_RUNS = 120;
