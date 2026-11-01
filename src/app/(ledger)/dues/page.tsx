"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { DuesPage } from "../../../views/DuesPage";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

export default function DuesRoute() {
  const { ledger, openSplitBill } = useLedgerWorkspace();
  const searchParams = useSearchParams();
  const ownerId = ledger.profile.id;
  const ownAccounts = useMemo(() => ledger.paymentAccounts.filter((account) => !ownerId || account.userId === ownerId), [ledger.paymentAccounts, ownerId]);

  return <DuesPage
    currency={ledger.profile.currency}
    items={ledger.dueItems}
    customCategories={ledger.customCategories}
    transactions={ledger.transactions}
    paymentAccounts={ownAccounts}
    calendarSystem={ledger.profile.calendarSystem}
    onSave={ledger.saveDueItem}
    onDelete={ledger.deleteDueItem}
    onRecordPayment={ledger.recordDuePayment}
    onComplete={ledger.completeDueItem}
    onUndoPayment={ledger.deleteDuePayment}
    onSplitBill={() => openSplitBill()}
    focusedId={searchParams.get("due")}
    focusedAction={searchParams.get("action") === "repay" ? "repay" : null}
  />;
}
