"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { CalculatorPage } from "../../../views/CalculatorPage";

export default function CalculatorRoute() {
  const { ledger, month } = useLedgerWorkspace();

  return <CalculatorPage
    currency={ledger.profile.currency}
    month={month}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    onSaveGoal={ledger.saveGoal}
    onSaveBudget={ledger.saveBudget}
  />;
}
