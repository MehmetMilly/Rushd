export type LocalCivilDate = `${number}-${number}-${number}`;
export type MoneyAmount = number;

export function isFiniteMoneyAmount(value: unknown): value is MoneyAmount {
  return typeof value === 'number' && Number.isFinite(value);
}
