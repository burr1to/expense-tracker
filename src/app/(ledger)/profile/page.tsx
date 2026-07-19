"use client";

import { useLedgerWorkspace } from "../../../context/LedgerWorkspaceContext";
import { SettingsPage } from "../../../views/SettingsPage";

export default function ProfileRoute() {
  const { lock } = useLedgerWorkspace();
  return <SettingsPage onLock={lock} />;
}
