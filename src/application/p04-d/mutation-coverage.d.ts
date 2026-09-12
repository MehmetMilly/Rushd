// P04-D1 declaration boundary for the mechanical mutation-coverage inventory.
// Runtime lives in `./mutation-coverage.js`; deep contracts in `./contracts.js`.
import type { FeaturePortName } from './contracts.js';

export interface MutationOwnerEntry {
  /** Exact controller method name in `src/app/root-controller.js`. */
  readonly action: string;
  /** The single feature port that owns this mutation. */
  readonly port: FeaturePortName;
  /** Short note naming the delegated v1 primitive. */
  readonly reason: string;
}

/** Complete D1 inventory, sorted by port then action. */
export const MUTATION_COVERAGE_INVENTORY: readonly MutationOwnerEntry[];

export function inventoryActions(): string[];
export function findDuplicateOwners(): string[];
export function findMissingOwners(detected: readonly string[]): string[];
export function findStaleEntries(knownMethods: readonly string[]): string[];
