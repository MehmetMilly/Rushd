/**
 * P04 Task A deterministic synthetic ledger generator.
 *
 * All records are fake (notes are `synthetic-*`). Two scenario sizes:
 * small (10 inflows, interactive latency) and larger (1,000 inflows,
 * representative ledger commit/reload shape). Generation is seeded and
 * deterministic so repeated cold/warm runs are comparable.
 */

export const LEDGER_SCENARIOS = {
  small: { entries: 10, label: 'small (10 inflows)' },
  large: { entries: 1000, label: 'larger (1,000 inflows)' },
} as const;

export type LedgerScenarioId = keyof typeof LEDGER_SCENARIOS;

export interface SyntheticInflow {
  readonly amountMinor: number;
  readonly localDate: string;
  readonly note: string;
}

export function syntheticInflows(scenario: LedgerScenarioId): readonly SyntheticInflow[] {
  const count = LEDGER_SCENARIOS[scenario].entries;
  const inflows: SyntheticInflow[] = [];
  let seed = scenario === 'small' ? 1234 : 987654;
  const nextRandom = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let index = 0; index < count; index += 1) {
    const amountMinor = 100 + Math.floor(nextRandom() * 9000);
    const day = 1 + Math.floor(nextRandom() * 27);
    const localDate = `2026-09-${String(day).padStart(2, '0')}`;
    inflows.push({ amountMinor, localDate, note: `synthetic-${scenario}-${index}` });
  }
  return inflows;
}
