"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { MapsPage } from "../../../views/MapsPage";

export default function MapsRoute() {
  const { ledger, openAdd, openEdit } = useLedgerWorkspace();

  return <MapsPage
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    onAdd={openAdd}
    onEdit={openEdit}
  />;
}
