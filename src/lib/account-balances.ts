import type { AccountTransfer, LedgerTransaction, PaymentAccount } from "../types";

type BalanceTransaction = Pick<LedgerTransaction, "paymentAccountId" | "kind" | "amountMinor" | "occurredOn" | "createdAt"> & Partial<Pick<LedgerTransaction, "paymentMode" | "userId">>;
type BalanceTransfer = Pick<AccountTransfer, "fromAccountId" | "toAccountId" | "amountMinor" | "occurredOn" | "createdAt">;

/**
 * Whether an entry moves this account's balance. Cash entries never carry an
 * account; a Cash in hand account collects its owner's cash entries instead.
 */
export function transactionPostsTo(item: BalanceTransaction, account: Pick<PaymentAccount, "id" | "type" | "userId">) {
  if (item.paymentAccountId) return item.paymentAccountId === account.id;
  return account.type === "cash" && item.paymentMode === "cash" && item.userId === account.userId;
}

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
  let incomeMinor = 0;
  let expenseMinor = 0;
  let transfersInMinor = 0;
  let transfersOutMinor = 0;
  for (const item of transactions) {
    if (!transactionPostsTo(item, account)) continue;
    if (!isAfterAccountAnchor(item.occurredOn, item.createdAt, account)) continue;
    if (throughDate && item.occurredOn > throughDate) continue;
    if (item.kind === "income") incomeMinor += item.amountMinor;
    else if (item.kind === "expense") expenseMinor += item.amountMinor;
  }
  for (const item of transfers) {
    if (!isAfterAccountAnchor(item.occurredOn, item.createdAt, account)) continue;
    if (throughDate && item.occurredOn > throughDate) continue;
    if (item.toAccountId === account.id) transfersInMinor += item.amountMinor;
    if (item.fromAccountId === account.id) transfersOutMinor += item.amountMinor;
  }
  return { incomeMinor, expenseMinor, transfersInMinor, transfersOutMinor };
}

function pushGroup<T>(groups: Map<string, T[]>, key: string, item: T) {
  const bucket = groups.get(key);
  if (bucket) bucket.push(item);
  else groups.set(key, [item]);
}

/** One index of the ledger, then one balance per account. */
export function attachCurrentBalances(accounts: readonly PaymentAccount[], transactions: readonly BalanceTransaction[], transfers: readonly BalanceTransfer[]): PaymentAccount[] {
  const transactionsByAccount = new Map<string, BalanceTransaction[]>();
  const cashAccountByOwner = new Map<string, string>();
  for (const account of accounts) if (account.type === "cash" && !cashAccountByOwner.has(account.userId)) cashAccountByOwner.set(account.userId, account.id);
  for (const item of transactions) {
    if (item.paymentAccountId) pushGroup(transactionsByAccount, item.paymentAccountId, item);
    else if (item.paymentMode === "cash" && item.userId && cashAccountByOwner.has(item.userId)) pushGroup(transactionsByAccount, cashAccountByOwner.get(item.userId)!, item);
  }
  const transfersByAccount = new Map<string, BalanceTransfer[]>();
  for (const item of transfers) {
    pushGroup(transfersByAccount, item.fromAccountId, item);
    if (item.toAccountId !== item.fromAccountId) pushGroup(transfersByAccount, item.toAccountId, item);
  }
  const emptyTransactions: BalanceTransaction[] = [];
  const emptyTransfers: BalanceTransfer[] = [];
  return accounts.map((account) => withCurrentAccountBalance(account, transactionsByAccount.get(account.id) ?? emptyTransactions, transfersByAccount.get(account.id) ?? emptyTransfers));
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

export interface TransferRemovalEffect {
  accountId: string;
  transferCount: number;
  /** How the other account's current balance changes once these transfers are gone. */
  changeMinor: number;
  /** Transfers newer than the other account's checked balance, the only ones its balance counts. */
  countedCount: number;
}

/**
 * Removing an account also removes its transfers. Money it sent to another
 * account then leaves that account, and money it received goes back.
 */
export function transferRemovalEffects(accountId: string, accounts: readonly PaymentAccount[], transfers: readonly BalanceTransfer[]): TransferRemovalEffect[] {
  const effects = new Map<string, TransferRemovalEffect>();
  for (const item of transfers) {
    if (item.fromAccountId !== accountId && item.toAccountId !== accountId) continue;
    const otherId = item.fromAccountId === accountId ? item.toAccountId : item.fromAccountId;
    if (otherId === accountId) continue;
    const effect = effects.get(otherId) ?? { accountId: otherId, transferCount: 0, changeMinor: 0, countedCount: 0 };
    effect.transferCount += 1;
    const other = accounts.find((account) => account.id === otherId);
    if (other && isAfterAccountAnchor(item.occurredOn, item.createdAt, other)) {
      effect.changeMinor += item.fromAccountId === accountId ? -item.amountMinor : item.amountMinor;
      effect.countedCount += 1;
    }
    effects.set(otherId, effect);
  }
  return [...effects.values()];
}

export function activityHasMovement(activity: AccountActivity) {
  return activity.incomeMinor !== 0 || activity.expenseMinor !== 0 || activity.transfersInMinor !== 0 || activity.transfersOutMinor !== 0;
}

export interface ReconciliationSpendingGap {
  beforeMonth: AccountActivity;
  duringMonth: AccountActivity;
  monthExpenseMinor: number;
  otherAccountExpenseMinor: number;
  alreadyInOpeningExpenseMinor: number;
}

function shiftIsoDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function activityDifference(later: AccountActivity, earlier: AccountActivity): AccountActivity {
  return {
    incomeMinor: later.incomeMinor - earlier.incomeMinor,
    expenseMinor: later.expenseMinor - earlier.expenseMinor,
    transfersInMinor: later.transfersInMinor - earlier.transfersInMinor,
    transfersOutMinor: later.transfersOutMinor - earlier.transfersOutMinor,
  };
}

/**
 * Explains why a reconciliation expense line and that calendar month's spending
 * can differ. The balance check runs from the account's confirmed snapshot
 * through the checked date. Month spending is every expense dated in the month
 * through that same date, including cash and other accounts.
 */
export function reconciliationSpendingGap(
  account: PaymentAccount,
  transactions: readonly BalanceTransaction[],
  transfers: readonly BalanceTransfer[],
  monthKey: string,
  checkedOn: string,
): ReconciliationSpendingGap {
  const monthStart = `${monthKey}-01`;
  const beforeMonth = accountActivityThrough(account, transactions, transfers, shiftIsoDate(monthStart, -1));
  const throughChecked = accountActivityThrough(account, transactions, transfers, checkedOn);
  const duringMonth = activityDifference(throughChecked, beforeMonth);
  let monthExpenseMinor = 0;
  let onThisAccount = 0;
  for (const item of transactions) {
    if (item.kind !== "expense" || item.occurredOn < monthStart || item.occurredOn > checkedOn) continue;
    monthExpenseMinor += item.amountMinor;
    if (transactionPostsTo(item, account)) onThisAccount += item.amountMinor;
  }
  const otherAccountExpenseMinor = monthExpenseMinor - onThisAccount;
  return {
    beforeMonth,
    duringMonth,
    monthExpenseMinor,
    otherAccountExpenseMinor,
    alreadyInOpeningExpenseMinor: onThisAccount - duringMonth.expenseMinor,
  };
}
