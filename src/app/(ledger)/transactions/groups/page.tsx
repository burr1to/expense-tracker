"use client";

import { useLedgerWorkspace } from "../../../../context/LedgerWorkspaceContext";
import { GroupsPage } from "../../../../views/GroupsPage";

export default function GroupsRoute() {
  const { ledger } = useLedgerWorkspace();

  return <GroupsPage
    currency={ledger.profile.currency}
    calendarSystem={ledger.profile.calendarSystem}
    groups={ledger.transactionGroups}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    onCreate={ledger.saveTransactionGroup}
  />;
}
