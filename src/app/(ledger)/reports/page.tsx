"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { ReportsPage } from "../../../views/ReportsPage";

export default function ReportsRoute() {
  const { ledger, month, setMonth, openAdd } = useLedgerWorkspace();

  return <ReportsPage
    month={month}
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    paymentAccounts={ledger.paymentAccounts}
    dueItems={ledger.dueItems}
    onMonthChange={setMonth}
    onAdd={openAdd}
  />;
}
