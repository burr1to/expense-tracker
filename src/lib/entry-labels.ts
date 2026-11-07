import { paymentAccountLabel } from "./payment-accounts";
import type { LedgerActivityItem } from "./transaction-history";
import type { AccountTransfer, LedgerTransaction, PaymentAccount } from "../types";

/** Amounts without the currency code, for rows where the code would only repeat. */
export const plainAmount = (minor: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(minor / 100);

export const activityKey = (item: LedgerActivityItem) => item.type === "transaction" ? `transaction-${item.transaction.id}` : `transfer-${item.transfer.id}`;

export function paymentLabel(transaction: LedgerTransaction, accounts: readonly PaymentAccount[]) {
  const account = transaction.paymentAccount ?? accounts.find((item) => item.id === transaction.paymentAccountId);
  if (account) return paymentAccountLabel(account);
  return transaction.paymentMode === "cheque" ? "Cheque" : transaction.paymentMode === "cash" ? "Cash" : "Online payment";
}

export function transferRoute(transfer: AccountTransfer, accounts: readonly PaymentAccount[]) {
  const label = (id: string) => { const account = accounts.find((item) => item.id === id); return account ? paymentAccountLabel(account) : "Removed account"; };
  return `${label(transfer.fromAccountId)} → ${label(transfer.toAccountId)}`;
}
