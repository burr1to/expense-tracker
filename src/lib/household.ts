export function transactionCountsTowardBudget(
  transaction: { userId: string; shared?: boolean },
  budget: { userId: string; shared?: boolean },
) {
  if (budget.shared) return transaction.shared === true;
  return transaction.userId === budget.userId && transaction.shared !== true;
}

export function canPostOnAccount(
  actorId: string,
  account: { userId: string; shared?: boolean },
  transactionShared: boolean,
  peerIds: readonly string[],
) {
  if (account.userId === actorId) return true;
  return transactionShared && account.shared === true && peerIds.includes(account.userId);
}
