"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { LogsPage } from "../../../views/LogsPage";

export default function LogsRoute() {
  const { ledger } = useLedgerWorkspace();
  return <LogsPage calendarSystem={ledger.profile.calendarSystem} activityRevision={ledger.activityRevision} />;
}
