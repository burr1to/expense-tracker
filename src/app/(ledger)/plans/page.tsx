"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { PlanningPage } from "../../../views/PlanningPage";
import { useMemo } from "react";

export default function PlansRoute() {
  const { ledger, month, setMonth } = useLedgerWorkspace();
  // A schedule can only be linked to your own accounts (the server refuses a partner's shared one).
  const ownerId = ledger.profile.id;
  const ownAccounts = useMemo(() => ledger.paymentAccounts.filter((account) => !ownerId || account.userId === ownerId), [ledger.paymentAccounts, ownerId]);

  return <PlanningPage
    month={month}
    calendarSystem={ledger.profile.calendarSystem}
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    budgets={ledger.budgets}
    recurringEntries={ledger.recurringEntries}
    dueItems={ledger.dueItems}
    goals={ledger.goals}
    customCategories={ledger.customCategories}
    paymentAccounts={ownAccounts}
    onMonthChange={setMonth}
    onSaveBudget={ledger.saveBudget}
    onDeleteBudget={ledger.deleteBudget}
    onSaveRecurring={ledger.saveRecurring}
    onDeleteRecurring={ledger.deleteRecurring}
    onSaveGoal={ledger.saveGoal}
    onContribute={ledger.contributeToGoal}
    onDeleteGoal={ledger.deleteGoal}
  />;
}
