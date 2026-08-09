export function calculateAllocationAmounts(totalMinor: number, percentages: readonly number[]): number[] {
  const safeTotalMinor = Number.isFinite(totalMinor) ? Math.max(0, Math.round(totalMinor)) : 0;
  const safePercentages = percentages.map((percentage) => Number.isFinite(percentage) ? Math.max(0, percentage) : 0);
  const amounts = safePercentages.map((percentage) => Math.round(safeTotalMinor * percentage / 100));
  const roundedAllocatedMinor = Math.round(safeTotalMinor * safePercentages.reduce((sum, percentage) => sum + percentage, 0) / 100);
  let lastUsedIndex = -1;
  for (let index = 0; index < safePercentages.length; index += 1) {
    if (safePercentages[index] > 0) lastUsedIndex = index;
  }

  if (lastUsedIndex >= 0) {
    const currentTotal = amounts.reduce((sum, amount) => sum + amount, 0);
    amounts[lastUsedIndex] += roundedAllocatedMinor - currentTotal;
  }

  return amounts;
}

export function minorToMajorInput(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2).replace(/\.?(0+)$/, "");
}
