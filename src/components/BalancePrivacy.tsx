"use client";

import { Modal, PasswordInput } from "@mantine/core";
import { LockKey, LockKeyOpen } from "@phosphor-icons/react";
import Link from "next/link";
import { useContext, useState } from "react";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { ButtonSpinner } from "./ButtonSpinner";

const PIN_SETUP_HREF = "/profile#security-heading";

/**
 * The one placeholder for anything that shows money you have: account
 * balances, safe-to-spend and the cash forecast. Its Unlock button opens the
 * shared PIN prompt, and one unlock reveals balances on every page.
 */
export function BalanceLocked({ title = "Balances are hidden", detail = "Enter your ledger PIN once to show balances on every page until the app locks.", compact = false }: { title?: string; detail?: string; compact?: boolean }) {
  const workspace = useContext(LedgerWorkspaceContext);
  const unlock = <button type="button" className={compact ? "text-button balance-locked-action" : "secondary-button small balance-locked-action"} onClick={() => workspace?.requestBalanceUnlock()} disabled={!workspace}><LockKeyOpen size={compact ? 14 : 16} />Unlock</button>;
  if (compact) return <span className="balance-locked compact"><LockKey size={14} weight="duotone" aria-hidden="true" /><span>{title}</span>{unlock}</span>;
  return <div className="balance-locked">
    <span className="balance-locked-icon" aria-hidden="true"><LockKey size={20} weight="duotone" /></span>
    <div><strong>{title}</strong>{detail && <p>{detail}</p>}</div>
    {unlock}
  </div>;
}

/** Stands in for one balance figure while balances are locked; the section's BalanceLocked carries the Unlock button. */
export function HiddenBalance() {
  return <span className="balance-hidden" aria-label="Hidden until you unlock balances">••••••</span>;
}

/** Shown beside balances when there is no PIN, so hiding them is one tap away. */
export function BalancePinHint() {
  return <Link className="balance-pin-hint" href={PIN_SETUP_HREF}><LockKey size={14} />Hide balances with a PIN</Link>;
}

/** Every "Set up PIN" action goes straight to the PIN form in Profile → Security. */
export function SetUpPinLink({ className = "secondary-button" }: { className?: string }) {
  return <Link className={className} href={PIN_SETUP_HREF}><LockKey size={17} />Set up PIN</Link>;
}

/** The shared PIN prompt, mounted once by LedgerAppLayout. */
export function BalanceUnlockDialog({ opened, onClose, onUnlock }: { opened: boolean; onClose: () => void; onUnlock: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (busy) return;
    setPin("");
    setError(null);
    onClose();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || pin.length < 4) return;
    setBusy(true);
    try {
      setError(null);
      await onUnlock(pin);
      setPin("");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock balances.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };
  return <Modal
    opened={opened}
    onClose={close}
    centered
    size="sm"
    title="Unlock balances"
    closeOnClickOutside={!busy}
    closeOnEscape={!busy}
    withCloseButton={!busy}
    classNames={{ content: "balance-unlock-dialog", header: "balance-unlock-dialog-header", title: "balance-unlock-dialog-title", body: "balance-unlock-dialog-body" }}
  >
    <form className="balance-unlock-form" onSubmit={submit} aria-busy={busy}>
      <p>Enter your ledger PIN to show balances, safe-to-spend and the forecast on every page. They hide again when the app locks.</p>
      <PasswordInput label="Ledger PIN" value={pin} onChange={(event) => setPin(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="current-password" autoFocus minLength={4} maxLength={6} required disabled={busy} error={error ?? undefined} />
      <button className="primary-button full-width" disabled={busy || pin.length < 4}>{busy ? <><ButtonSpinner />Checking…</> : "Unlock balances"}</button>
    </form>
  </Modal>;
}
