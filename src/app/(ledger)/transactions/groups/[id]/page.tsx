"use client";

import { useParams } from "next/navigation";
import { useLedgerWorkspace } from "../../../../../context/LedgerWorkspaceContext";
import { GroupDetailPage } from "../../../../../views/GroupDetailPage";

export default function GroupDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const { ledger, openEdit, openDuplicate } = useLedgerWorkspace();

  return <GroupDetailPage
    key={id}
    groupId={decodeURIComponent(id)}
    currency={ledger.profile.currency}
    calendarSystem={ledger.profile.calendarSystem}
    groups={ledger.transactionGroups}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    paymentAccounts={ledger.paymentAccounts}
    ownerId={ledger.profile.id}
    onSaveGroup={ledger.saveTransactionGroup}
    onDeleteGroup={ledger.deleteTransactionGroup}
    onSetGroup={ledger.setTransactionGroup}
    onEdit={openEdit}
    onDuplicate={openDuplicate}
  />;
}
