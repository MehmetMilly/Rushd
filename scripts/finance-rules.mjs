export function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function calculateSafeToSpend({ budget, paidSpent, unpaidEssential }) {
  return (
    toFiniteNumber(budget, 0)
    - toFiniteNumber(paidSpent, 0)
    - toFiniteNumber(unpaidEssential, 0)
  );
}

export function calculateFlexibleUsage(definition, expenses = []) {
  const id = definition?.id;
  const monthlyBudget = Math.max(0, toFiniteNumber(definition?.monthlyBudget, 0));
  const maxUsesPerMonth = Math.max(0, Math.trunc(toFiniteNumber(definition?.maxUsesPerMonth, 0)));
  const matchingExpenses = expenses.filter((expense) => expense?.flexibleDefinitionId === id);
  const usedBudget = matchingExpenses.reduce((sum, expense) => {
    const amount = expense?.isPaid
      ? toFiniteNumber(expense?.actualPaid, 0)
      : toFiniteNumber(expense?.expectedCost, 0);
    return sum + Math.max(0, amount);
  }, 0);

  return {
    monthlyBudget,
    maxUsesPerMonth,
    usedBudget,
    remainingBudget: Math.max(0, monthlyBudget - usedBudget),
    uses: matchingExpenses.length,
    remainingUses: Math.max(0, maxUsesPerMonth - matchingExpenses.length)
  };
}

export function calculateVaultBalance(transactions = []) {
  return Math.max(0, transactions.reduce((sum, transaction) => {
    return sum + toFiniteNumber(transaction?.amount, 0);
  }, 0));
}

export function calculateGoalProgress(goal, vaultBalance) {
  const targetAmount = Math.max(0, toFiniteNumber(goal?.targetAmount, 0));
  const progressAmount = Math.min(toFiniteNumber(vaultBalance, 0), targetAmount);
  const progressPercentage = targetAmount > 0
    ? Math.min(100, (progressAmount / targetAmount) * 100)
    : 0;

  return {
    targetAmount,
    progressAmount,
    progressPercentage
  };
}
