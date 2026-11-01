"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { CalculatorPage } from "../../../views/CalculatorPage";

export default function CalculatorRoute() {
  const { ledger, period } = useLedgerWorkspace();

  return <CalculatorPage
    currency={ledger.profile.currency}
    period={period}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    goals={ledger.goals}
    onSaveGoal={ledger.saveGoal}
    onSaveBudgets={ledger.saveBudgets}
  />;
}
