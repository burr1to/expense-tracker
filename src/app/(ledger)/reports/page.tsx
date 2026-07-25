"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { useAuth } from "../../../context/AuthContext";
import { ReportsPage } from "../../../views/ReportsPage";

export default function ReportsRoute() {
  const { user, isDemo } = useAuth();
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
    allowPdfDownload={Boolean(user && !isDemo)}
  />;
}
