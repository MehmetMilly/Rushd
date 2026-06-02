import assert from 'node:assert/strict';
import {
  calculateFlexibleUsage,
  calculateGoalProgress,
  calculateSafeToSpend,
  calculateVaultBalance,
  toFiniteNumber
} from './finance-rules.mjs';

assert.equal(toFiniteNumber('12.5'), 12.5);
assert.equal(toFiniteNumber('not a number', 7), 7);

assert.equal(
  calculateSafeToSpend({ budget: 1000, paidSpent: 210, unpaidEssential: 140 }),
  650
);

assert.equal(
  calculateSafeToSpend({ budget: 500, paidSpent: 700, unpaidEssential: 50 }),
  -250
);

// Flexible usage mirrors the live app: it counts the expected cost against
// the monthly flexible budget, even after an expense is marked paid.
const flexibleUsage = calculateFlexibleUsage(
  { id: 'coffee', monthlyBudget: 120, maxUsesPerMonth: 4 },
  [
    { flexibleDefinitionId: 'coffee', isPaid: true, actualPaid: 20, expectedCost: 25 },
    { flexibleDefinitionId: 'coffee', isPaid: false, expectedCost: 30 },
    { flexibleDefinitionId: 'other', isPaid: true, actualPaid: 99 }
  ]
);

assert.deepEqual(flexibleUsage, {
  monthlyBudget: 120,
  maxUsesPerMonth: 4,
  usedBudget: 55,
  remainingBudget: 65,
  uses: 2,
  remainingUses: 2
});

assert.equal(
  calculateVaultBalance([{ amount: 100 }, { amount: -20 }, { amount: 50 }]),
  130
);

assert.deepEqual(calculateGoalProgress({ targetAmount: 200 }, 50), {
  targetAmount: 200,
  progressAmount: 50,
  progressPercentage: 25
});

assert.deepEqual(calculateGoalProgress({ targetAmount: 200 }, 250), {
  targetAmount: 200,
  progressAmount: 200,
  progressPercentage: 100
});

console.log('Rushd finance rule tests passed.');
