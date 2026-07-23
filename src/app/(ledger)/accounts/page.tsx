"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { AccountsPage } from "../../../views/AccountsPage";

export default function AccountsRoute() {
  const { openAdd, openEdit, removeTransaction } = useLedgerWorkspace();
  return <AccountsPage onAdd={openAdd} onEdit={openEdit} onDelete={removeTransaction} />;
}
