"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { useAuth } from "../../../context/AuthContext";
import { ReportsPage } from "../../../views/ReportsPage";

export default function ReportsRoute() {
  const { user, isDemo } = useAuth();
  const { ledger, period, setPeriod, openAdd } = useLedgerWorkspace();

  return <ReportsPage
    period={period}
    calendarSystem={ledger.profile.calendarSystem}
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    paymentAccounts={ledger.paymentAccounts}
    dueItems={ledger.dueItems}
    onPeriodChange={setPeriod}
    onAdd={openAdd}
    allowPdfDownload={Boolean(user && !isDemo)}
  />;
}
