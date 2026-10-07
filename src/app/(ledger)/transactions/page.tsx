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

  return <TransactionsPage
    month={month}
    calendarSystem={ledger.profile.calendarSystem}
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    transfers={ledger.transfers}
    customCategories={ledger.customCategories}
    customSubcategories={ledger.customSubcategories}
    paymentAccounts={ledger.paymentAccounts}
    onMonthChange={setMonth}
    onAdd={openAddForDate}
    onDuplicate={openDuplicate}
    onEdit={openEdit}
    onDelete={removeTransaction}
    onDeleteTransfer={ledger.deleteTransfer}
    onImport={importPastTransactions}
    importJobs={ledger.importJobs}
    onDismissImportJob={ledger.dismissImportJob}
  />;
}
