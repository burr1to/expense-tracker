import type { AccountTransfer, LedgerTransaction, PaymentAccount } from "../types";

function isAfterAnchor(date: string, createdAt: string, account: PaymentAccount) {
  if (date > account.balanceAsOf) return true;
  if (date < account.balanceAsOf) return false;
  return createdAt > account.balanceRecordedAt;
}

export function calculateCurrentAccountBalance(account: PaymentAccount, transactions: readonly LedgerTransaction[], transfers: readonly AccountTransfer[]) {
  const transactionDelta = transactions
    .filter((item) => item.paymentAccountId === account.id && isAfterAnchor(item.occurredOn, item.createdAt, account))
    .reduce((total, item) => total + (item.kind === "income" ? item.amountMinor : -item.amountMinor), 0);
  const transferDelta = transfers
    .filter((item) => isAfterAnchor(item.occurredOn, item.createdAt, account) && (item.fromAccountId === account.id || item.toAccountId === account.id))
    .reduce((total, item) => total + (item.toAccountId === account.id ? item.amountMinor : -item.amountMinor), 0);
  return account.balanceMinor + transactionDelta + transferDelta;
}

export function withCurrentAccountBalance(account: PaymentAccount, transactions: readonly LedgerTransaction[], transfers: readonly AccountTransfer[]) {
  return { ...account, currentBalanceMinor: calculateCurrentAccountBalance(account, transactions, transfers) };
}

export function totalCurrentBalance(accounts: readonly PaymentAccount[]) {
  return accounts.reduce((total, account) => total + account.currentBalanceMinor, 0);
}
