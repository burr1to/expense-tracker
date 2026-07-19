"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { DuesPage } from "../../../views/DuesPage";

export default function DuesRoute() {
  const { ledger } = useLedgerWorkspace();

  return <DuesPage
    currency={ledger.profile.currency}
    items={ledger.dueItems}
    customCategories={ledger.customCategories}
    onSave={ledger.saveDueItem}
    onDelete={ledger.deleteDueItem}
    onRecordPayment={ledger.recordDuePayment}
    onComplete={ledger.completeDueItem}
  />;
}
