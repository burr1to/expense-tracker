"use client";

import { useLedgerWorkspace } from "../../../../context/LedgerWorkspaceContext";
import { AddMultiplePage } from "../../../../views/AddMultiplePage";

export default function AddMultipleRoute() {
  const { ledger, completeOnboardingStep } = useLedgerWorkspace();

  return <AddMultiplePage
    currency={ledger.profile.currency}
    calendarSystem={ledger.profile.calendarSystem}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    paymentAccounts={ledger.paymentAccounts}
    ownerId={ledger.profile.id}
    onImport={async (drafts) => {
      const job = await ledger.importTransactions(drafts);
      completeOnboardingStep("import");
      return job;
    }}
  />;
}
