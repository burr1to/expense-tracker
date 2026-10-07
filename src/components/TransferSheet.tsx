"use client";

import { NumberInput, Select, TextInput } from "@mantine/core";
import { ArrowsDownUp, ArrowsLeftRight, WarningCircle, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { majorToMinor } from "../lib/currency";
import { formatLedgerDate, todayInput } from "../lib/dates";
import { findSimilarTransfer, isCashAccount, paymentAccountLabel, transferAccountDefaults, type TransferAccounts } from "../lib/payment-accounts";
import { newClientRequestId } from "../lib/transaction-defaults";
import type { AccountTransfer, AccountTransferDraft, CalendarSystem, CurrencyCode, PaymentAccount } from "../types";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { ButtonSpinner } from "./ButtonSpinner";
import { FormError } from "./FormError";
import type { TransferRequest } from "./LedgerAppLayout";
import { LedgerDatePickerInput as DatePickerInput } from "./LedgerDatePickerInput";

const LAST_ROUTE_KEY = "saveyorupee:last-transfer:v1";

function readLastRoute(): Partial<TransferAccounts> | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAST_ROUTE_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { fromAccountId, toAccountId } = parsed as Record<string, unknown>;
    return { fromAccountId: typeof fromAccountId === "string" ? fromAccountId : undefined, toAccountId: typeof toAccountId === "string" ? toAccountId : undefined };
  } catch { return null; }
}

function rememberRoute(route: TransferAccounts) {
  try { window.localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify(route)); } catch { /* Private mode or blocked storage: the next sheet just starts empty. */ }
}

interface TransferSheetProps {
  /** null keeps the sheet closed; every new request opens a fresh form. */
  request: TransferRequest | null;
  currency: CurrencyCode;
  calendarSystem?: CalendarSystem;
  /** Your own accounts; a transfer moves money only between accounts you added. */
  accounts: PaymentAccount[];
  transfers: AccountTransfer[];
  onClose: () => void;
  onSave: (draft: AccountTransferDraft, id?: string) => Promise<void>;
}

export function TransferSheet({ request, ...props }: TransferSheetProps) {
  // The form outlives a close so it can animate out, and starts over on the next open.
  const [shown, setShown] = useState<{ key: number; request: TransferRequest } | null>(request ? { key: 1, request } : null);
  if (request && request !== shown?.request) setShown({ key: (shown?.key ?? 0) + 1, request });
  const [busy, setBusy] = useState(false);
  return <AnimatedOverlay open={Boolean(request)} dismissOnBackdrop onClose={() => { if (!busy) props.onClose(); }}>
    {shown && <TransferForm key={shown.key} request={shown.request} onBusyChange={setBusy} {...props} />}
  </AnimatedOverlay>;
}

function TransferForm({ request, currency, calendarSystem = "AD", accounts, transfers, onClose, onSave, onBusyChange }: Omit<TransferSheetProps, "request"> & { request: TransferRequest; onBusyChange: (busy: boolean) => void }) {
  const editing = request.transferId ? transfers.find((transfer) => transfer.id === request.transferId) ?? null : null;
  const [clientRequestId] = useState(newClientRequestId);
  const [route, setRoute] = useState<TransferAccounts>(() => editing
    ? { fromAccountId: editing.fromAccountId, toAccountId: editing.toAccountId }
    : transferAccountDefaults(accounts, request, readLastRoute()));
  const [amount, setAmount] = useState<string | number>(() => editing ? editing.amountMinor / 100 : request.amount ?? "");
  const [occurredOn, setOccurredOn] = useState(() => editing?.occurredOn ?? request.occurredOn ?? todayInput());
  const [note, setNote] = useState(() => editing?.note ?? request.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(request.transferId && !editing ? "This transfer no longer exists." : null);
  const options = useMemo(() => accounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) })), [accounts]);
  const label = (id: string) => options.find((option) => option.value === id)?.label ?? "the account";
  const amountMinor = majorToMinor(String(amount ?? ""));
  const sameAccount = Boolean(route.fromAccountId && route.fromAccountId === route.toAccountId);
  const canSave = !saving && amountMinor > 0 && Boolean(route.fromAccountId && route.toAccountId) && !sameAccount && Boolean(occurredOn) && !(request.transferId && !editing);
  const [saved, setSaved] = useState(false);
  // Once saved, the closing sheet would otherwise find the transfer it just recorded.
  const similar = saved || sameAccount ? null : findSimilarTransfer(transfers, { ...route, amountMinor, occurredOn }, editing?.id);
  const close = () => { if (!saving) onClose(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true); onBusyChange(true); setError(null);
    try {
      await onSave({ ...route, amount: String(amount), occurredOn, note: note.trim(), clientRequestId }, editing?.id);
      setSaved(true);
      if (!editing) rememberRoute(route);
      onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not record the transfer."); }
    finally { setSaving(false); onBusyChange(false); }
  };

  return <section className="transfer-sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-sheet-title" aria-busy={saving}>
    <header>
      <div><span className="eyebrow">Between your accounts</span><h2 id="transfer-sheet-title">{request.transferId ? "Edit transfer" : "Move money"}</h2></div>
      <button type="button" className="icon-button" disabled={saving} onClick={close} aria-label="Close"><X size={20} /></button>
    </header>
    {accounts.length < 2 && !editing ? <div className="transfer-sheet-body">
      <p className="transfer-sheet-empty">Add at least two of your own accounts to move money between them. Cash in hand counts as one.</p>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><Link className="primary-button" href="/accounts#add-account" onClick={onClose}>Add an account</Link></div>
    </div> : <form className="transfer-sheet-body" onSubmit={save}>
      <div className="transfer-sheet-route">
        <Select label="From" placeholder="Choose the source" value={route.fromAccountId || null} onChange={(value) => setRoute((current) => ({ ...current, fromAccountId: value ?? "" }))} data={options} allowDeselect={false} searchable={options.length > 6} disabled={saving} />
        <button type="button" className="icon-button transfer-sheet-swap" disabled={saving || (!route.fromAccountId && !route.toAccountId)} onClick={() => setRoute((current) => ({ fromAccountId: current.toAccountId, toAccountId: current.fromAccountId }))} aria-label="Swap From and To" title="Swap"><ArrowsDownUp size={17} /></button>
        <Select label="To" placeholder="Choose the destination" value={route.toAccountId || null} onChange={(value) => setRoute((current) => ({ ...current, toAccountId: value ?? "" }))} data={options.map((option) => ({ ...option, disabled: option.value === route.fromAccountId }))} allowDeselect={false} searchable={options.length > 6} disabled={saving} error={sameAccount ? "Choose two different accounts." : undefined} />
      </div>
      <div className="transfer-sheet-grid">
        <NumberInput label={`Amount in ${currency}`} value={amount} onChange={setAmount} min={0} decimalScale={2} thousandSeparator="," placeholder="5,000" required disabled={saving} data-autofocus />
        <DatePickerInput label="Date" description={calendarSystem === "BS" && occurredOn ? formatLedgerDate(occurredOn, "BS") : undefined} value={occurredOn} onChange={(value) => value && setOccurredOn(value)} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required disabled={saving} />
      </div>
      <TextInput label="Note" value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder="Optional, e.g. eSewa load" maxLength={240} disabled={saving} />
      <p className="field-hint transfer-sheet-hint"><ArrowsLeftRight size={14} aria-hidden /> {route.fromAccountId && route.toAccountId && !sameAccount ? `${label(route.fromAccountId)} goes down and ${label(route.toAccountId)} goes up by the same amount.` : "Moving money is not counted as income or spending."}</p>
      {similar && <p className="field-hint transfer-sheet-similar" role="status"><WarningCircle size={14} aria-hidden /> A transfer of this amount from {label(similar.fromAccountId)} to {label(similar.toAccountId)} is already saved for {formatLedgerDate(similar.occurredOn, calendarSystem)}. Save this only if you moved the money twice.</p>}
      {!accounts.some(isCashAccount) && <p className="field-hint">Took cash from an ATM? <Link href="/accounts#add-account" onClick={onClose}>Add Cash in hand</Link> to record it here.</p>}
      <FormError message={error} />
      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={saving} onClick={close}>Cancel</button>
        <button type="submit" className="primary-button" disabled={!canSave}>{saving ? <><ButtonSpinner />Saving…</> : request.transferId ? "Save changes" : <><ArrowsLeftRight size={17} />Move money</>}</button>
      </div>
    </form>}
  </section>;
}
