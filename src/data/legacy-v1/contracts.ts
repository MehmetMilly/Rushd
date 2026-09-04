export type LegacyIsoDate = `${number}-${number}-${number}`;

export interface LegacyExpenseRecord {
  id: string;
  date: LegacyIsoDate;
  name?: string;
  expectedCost?: number;
  actualPaid?: number;
  isPaid?: boolean;
  category?: string;
  classification?: 'essential' | 'luxury' | string;
  source?: 'manual' | 'template' | 'flexible';
  createdAt?: string;
  [field: string]: unknown;
}

export interface LegacySettingRecord {
  key: string;
  value: unknown;
}

export const LEGACY_V1_DATABASE = {
  name: 'MicroSaveOS_DB',
  version: 1,
  stores: ['settings', 'templates', 'expenses'] as const
} as const;
