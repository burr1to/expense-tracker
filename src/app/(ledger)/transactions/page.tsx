"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { TransactionsPage } from "../../../views/TransactionsPage";

export default function TransactionsRoute() {
  const {
    ledger,
    month,
    setMonth,
    openAddForDate,
    openDuplicate,
    openEdit,
    removeTransaction,
  } = useLedgerWorkspace();

  return <TransactionsPage
    month={month}
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    customSubcategories={ledger.customSubcategories}
    paymentAccounts={ledger.paymentAccounts}
    onMonthChange={setMonth}
    onAdd={openAddForDate}
    onDuplicate={openDuplicate}
    onEdit={openEdit}
    onDelete={removeTransaction}
    onImport={ledger.importTransactions}
    onSaveReceiptSplit={ledger.saveReceiptSplit}
  />;
}
