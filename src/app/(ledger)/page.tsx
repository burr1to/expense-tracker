"use client";

import { useLedgerWorkspace } from "../../context/LedgerWorkspaceContext";
import { DashboardPage } from "../../views/DashboardPage";
import { useRouter } from "next/navigation";

export default function DashboardRoute() {
  const router = useRouter();
  const {
    ledger,
    month,
    setMonth,
    homeFocus,
    setHomeSelectedDate,
    openAddForDate,
    navigate,
  } = useLedgerWorkspace();

  return <DashboardPage
    month={month}
    focus={homeFocus}
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    budgets={ledger.budgets}
    recurringEntries={ledger.recurringEntries}
    dueItems={ledger.dueItems}
    goals={ledger.goals}
    customCategories={ledger.customCategories}
    paymentAccounts={ledger.paymentAccounts}
    savedPlaces={ledger.savedPlaces}
    hasPin={ledger.profile.hasPin}
    onMonthChange={setMonth}
    onAdd={openAddForDate}
    onSelectedDayChange={setHomeSelectedDate}
    onNavigate={navigate}
    onOpenPlace={(placeKey) => router.push(`/maps?place=${encodeURIComponent(placeKey)}`)}
    onConfirmRecurring={ledger.confirmRecurring}
    onVerifyPin={ledger.verifyPin}
  />;
}
