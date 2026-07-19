"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { PlanningPage } from "../../../views/PlanningPage";

export default function PlansRoute() {
  const { ledger, month, setMonth } = useLedgerWorkspace();

  return <PlanningPage
    month={month}
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    budgets={ledger.budgets}
    recurringEntries={ledger.recurringEntries}
    dueItems={ledger.dueItems}
    goals={ledger.goals}
    customCategories={ledger.customCategories}
    onMonthChange={setMonth}
    onSaveBudget={ledger.saveBudget}
    onDeleteBudget={ledger.deleteBudget}
    onSaveRecurring={ledger.saveRecurring}
    onDeleteRecurring={ledger.deleteRecurring}
    onConfirmRecurring={ledger.confirmRecurring}
    onSaveGoal={ledger.saveGoal}
    onContribute={ledger.contributeToGoal}
    onDeleteGoal={ledger.deleteGoal}
  />;
}
