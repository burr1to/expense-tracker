"use client";

import { useLedgerWorkspace } from "../../context/LedgerWorkspaceContext";
import { DashboardPage } from "../../views/DashboardPage";
import { useRouter } from "next/navigation";

export default function DashboardRoute() {
  const router = useRouter();
  const {
    ledger,
    period,
    setPeriod,
    homeFocus,
    setHomeSelectedDate,
    openAddForDate,
    navigate,
  } = useLedgerWorkspace();

  return <DashboardPage
    period={period}
    calendarSystem={ledger.profile.calendarSystem}
    focus={homeFocus}
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    transfers={ledger.transfers}
    budgets={ledger.budgets}
    recurringEntries={ledger.recurringEntries}
    dueItems={ledger.dueItems}
    goals={ledger.goals}
    customCategories={ledger.customCategories}
    paymentAccounts={ledger.paymentAccounts}
    savedPlaces={ledger.savedPlaces}
    hasPin={ledger.profile.hasPin}
    safeToSpendBufferMinor={ledger.profile.safeToSpendBufferMinor}
    onPeriodChange={setPeriod}
    onAdd={openAddForDate}
    onSelectedDayChange={setHomeSelectedDate}
    onNavigate={navigate}
    onOpenPlace={(placeKey) => router.push(`/maps?place=${encodeURIComponent(placeKey)}`)}
    onVerifyPin={ledger.verifyPin}
  />;
}
