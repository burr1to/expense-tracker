import type { AccountTransfer, LedgerTransaction, PaymentAccount } from "../types";

type BalanceTransaction = Pick<LedgerTransaction, "paymentAccountId" | "kind" | "amountMinor" | "occurredOn" | "createdAt">;
type BalanceTransfer = Pick<AccountTransfer, "fromAccountId" | "toAccountId" | "amountMinor" | "occurredOn" | "createdAt">;

export function isAfterAccountAnchor(date: string, createdAt: string, account: PaymentAccount) {
  if (date > account.balanceAsOf) return true;
  if (date < account.balanceAsOf) return false;
  return createdAt > account.balanceRecordedAt;
}

export interface AccountActivity {
  incomeMinor: number;
  expenseMinor: number;
  transfersInMinor: number;
  transfersOutMinor: number;
}

export function accountActivityThrough(
  account: PaymentAccount,
  transactions: readonly BalanceTransaction[],
  transfers: readonly BalanceTransfer[],
  throughDate?: string,
): AccountActivity {
  const accountTransactions = transactions.filter((item) =>
    item.paymentAccountId === account.id
    && isAfterAccountAnchor(item.occurredOn, item.createdAt, account)
    && (!throughDate || item.occurredOn <= throughDate),
  );
  const accountTransfers = transfers.filter((item) =>
    isAfterAccountAnchor(item.occurredOn, item.createdAt, account)
    && (!throughDate || item.occurredOn <= throughDate)
    && (item.fromAccountId === account.id || item.toAccountId === account.id),
  );
  return {
    incomeMinor: accountTransactions.filter((item) => item.kind === "income").reduce((total, item) => total + item.amountMinor, 0),
    expenseMinor: accountTransactions.filter((item) => item.kind === "expense").reduce((total, item) => total + item.amountMinor, 0),
    transfersInMinor: accountTransfers.filter((item) => item.toAccountId === account.id).reduce((total, item) => total + item.amountMinor, 0),
    transfersOutMinor: accountTransfers.filter((item) => item.fromAccountId === account.id).reduce((total, item) => total + item.amountMinor, 0),
  };
}

export function expectedAccountBalanceThrough(account: PaymentAccount, transactions: readonly BalanceTransaction[], transfers: readonly BalanceTransfer[], throughDate: string) {
  const activity = accountActivityThrough(account, transactions, transfers, throughDate);
  return {
    ...activity,
    expectedBalanceMinor: account.balanceMinor + activity.incomeMinor - activity.expenseMinor + activity.transfersInMinor - activity.transfersOutMinor,
  };
}

export function calculateCurrentAccountBalance(account: PaymentAccount, transactions: readonly BalanceTransaction[], transfers: readonly BalanceTransfer[]) {
  const activity = accountActivityThrough(account, transactions, transfers);
  return account.balanceMinor + activity.incomeMinor - activity.expenseMinor + activity.transfersInMinor - activity.transfersOutMinor;
}

export function withCurrentAccountBalance(account: PaymentAccount, transactions: readonly BalanceTransaction[], transfers: readonly BalanceTransfer[]) {
  return { ...account, currentBalanceMinor: calculateCurrentAccountBalance(account, transactions, transfers) };
}

export function totalCurrentBalance(accounts: readonly PaymentAccount[]) {
  return accounts.reduce((total, account) => total + account.currentBalanceMinor, 0);
}
