"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { MapsPage } from "../../../views/MapsPage";

export default function MapsRoute() {
  const { ledger, openAdd, openAddAtPlace, openEdit } = useLedgerWorkspace();

  return <MapsPage
    currency={ledger.profile.currency}
    transactions={ledger.transactions}
    customCategories={ledger.customCategories}
    paymentAccounts={ledger.paymentAccounts}
    savedPlaces={ledger.savedPlaces}
    onSaveSavedPlace={ledger.saveSavedPlace}
    onDeleteSavedPlace={ledger.deleteSavedPlace}
    onAdd={openAdd}
    onAddAtPlace={openAddAtPlace}
    onEdit={openEdit}
  />;
}
