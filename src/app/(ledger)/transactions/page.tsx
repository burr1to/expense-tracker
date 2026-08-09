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
    completeOnboardingStep,
  } = useLedgerWorkspace();

  const importPastTransactions = async (...args: Parameters<typeof ledger.importTransactions>) => {
    const job = await ledger.importTransactions(...args);
    completeOnboardingStep("import");
    return job;
  };
  const saveReceiptSplit = async (...args: Parameters<typeof ledger.saveReceiptSplit>) => {
    const count = await ledger.saveReceiptSplit(...args);
    completeOnboardingStep("transaction");
    return count;
  };

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
    onImport={importPastTransactions}
    importJobs={ledger.importJobs}
    onDismissImportJob={ledger.dismissImportJob}
    onSaveReceiptSplit={saveReceiptSplit}
  />;
}
