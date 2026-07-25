"use client";

import { useLedgerWorkspace } from "../../context/LedgerWorkspaceContext";
import { useAuth } from "../../context/AuthContext";
import { monthlyReportNotice } from "../../lib/monthly-report";
import { DashboardPage } from "../../views/DashboardPage";
import { useRouter } from "next/navigation";

export default function DashboardRoute() {
  const { user, isDemo } = useAuth();
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
    monthlyReport={user && !isDemo ? monthlyReportNotice() : null}
    onMonthChange={setMonth}
    onAdd={openAddForDate}
    onSelectedDayChange={setHomeSelectedDate}
    onNavigate={navigate}
    onOpenPlace={(placeKey) => router.push(`/maps?place=${encodeURIComponent(placeKey)}`)}
    onConfirmRecurring={ledger.confirmRecurring}
    onVerifyPin={ledger.verifyPin}
  />;
}
