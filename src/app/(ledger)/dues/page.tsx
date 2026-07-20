"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { DuesPage } from "../../../views/DuesPage";
import { useSearchParams } from "next/navigation";

export default function DuesRoute() {
  const { ledger } = useLedgerWorkspace();
  const searchParams = useSearchParams();

  return <DuesPage
    currency={ledger.profile.currency}
    items={ledger.dueItems}
    customCategories={ledger.customCategories}
    onSave={ledger.saveDueItem}
    onDelete={ledger.deleteDueItem}
    onRecordPayment={ledger.recordDuePayment}
    onComplete={ledger.completeDueItem}
    focusedId={searchParams.get("due")}
    focusedAction={searchParams.get("action") === "repay" ? "repay" : null}
  />;
}
