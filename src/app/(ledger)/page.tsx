"use client";

import { AgentReviewCard } from "../../components/AgentReviewCard";
import { useLedgerWorkspace } from "../../context/LedgerWorkspaceContext";
import { HomePage } from "../../views/HomePage";

export default function DashboardRoute() {
  const { ledger, period, setPeriod, openAdd, openEdit, agentDrafts, reviewAgentDraft, dismissAgentDraft } = useLedgerWorkspace();

  return <HomePage
    period={period}
    calendarSystem={ledger.profile.calendarSystem}
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    paymentAccounts={ledger.paymentAccounts}
    customCategories={ledger.customCategories}
    onPeriodChange={setPeriod}
    onAdd={openAdd}
    onOpenEntry={(transaction) => { if (ledger.profile.id && transaction.userId !== ledger.profile.id) return; openEdit(transaction); }}
    reviewQueue={<AgentReviewCard drafts={agentDrafts} onReview={reviewAgentDraft} onDismiss={dismissAgentDraft} />}
  />;
}
