"use client";

import { useLedgerWorkspace } from "../../../../context/LedgerWorkspaceContext";
import { EditTransactionsPage } from "../../../../views/EditTransactionsPage";

export default function EditTransactionsRoute() {
  const { ledger } = useLedgerWorkspace();

  return <EditTransactionsPage
    currency={ledger.profile.currency}
    calendarSystem={ledger.profile.calendarSystem}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    customSubcategories={ledger.customSubcategories}
    paymentAccounts={ledger.paymentAccounts}
    reconciliations={ledger.reconciliations}
    ownerId={ledger.profile.id}
    onSave={ledger.updateTransactions}
  />;
}
