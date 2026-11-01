"use client";

import { NumberInput, Select } from "@mantine/core";
import { Check, PauseCircle, SkipForward, X } from "@phosphor-icons/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useLedger } from "../context/LedgerContext";
import { getCategory } from "../lib/categories";
import { formatMoney, majorToMinor } from "../lib/currency";
import { formatLedgerDay, todayInput } from "../lib/dates";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { recurrenceLabel } from "../lib/recurrence";
import type { PaymentAccount, PaymentMode, RecurringEntry } from "../types";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { ButtonSpinner } from "./ButtonSpinner";
import { FormError } from "./FormError";
import { LedgerDatePickerInput as DatePickerInput } from "./LedgerDatePickerInput";

type SheetAction = "record" | "skip" | "pause";
interface Draft { amount: string; occurredOn: string; paymentMode: PaymentMode; paymentAccountId: string }

// A schedule paid from Cash in hand records as cash, which that account collects on its own.
const draftFor = (entry: RecurringEntry, accounts: readonly PaymentAccount[]): Draft => {
  const online = Boolean(entry.paymentAccountId && accounts.some((account) => account.id === entry.paymentAccountId));
  return { amount: String(entry.amountMinor / 100), occurredOn: entry.nextDueOn, paymentMode: online ? "online" : "cash", paymentAccountId: online ? entry.paymentAccountId ?? "" : "" };
};

interface RecurringConfirmSheetProps {
  /** The recurring entry to review; null closes the sheet. */
  entryId: string | null;
  onClose: () => void;
}

/** Reviews one due recurring entry: record it as scheduled or adjusted, skip this occurrence, or pause the schedule. */
export function RecurringConfirmSheet({ entryId, onClose }: RecurringConfirmSheetProps) {
  const { recurringEntries, paymentAccounts, customCategories, profile, confirmRecurring, skipRecurring, setRecurringActive } = useLedger();
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [entry, setEntry] = useState<RecurringEntry | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<SheetAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A recurring entry is personal, so only the user's own accounts can take it (the server refuses a household peer's).
  const accounts = onlinePaymentAccounts(paymentAccounts).filter((account) => account.userId === profile.id);
  // Snapshot on open, so the sheet never jumps to the next occurrence while it closes after recording.
  if (entryId !== openedId) {
    setOpenedId(entryId);
    const next = entryId ? recurringEntries.find((item) => item.id === entryId) ?? null : null;
    if (next) {
      setEntry(next);
      setDraft(draftFor(next, accounts));
      setError(null);
    }
  }
  if (!entry || !draft) return null;

  const currency = profile.currency;
  const label = entry.note || getCategory(entry.category, customCategories).label;
  const amountMinor = majorToMinor(draft.amount);
  const notDue = entry.nextDueOn > todayInput();
  const accountMissing = draft.paymentMode === "online" && !draft.paymentAccountId;
  const canRecord = !notDue && amountMinor > 0 && Boolean(draft.occurredOn) && !accountMissing;
  const update = (changes: Partial<Draft>) => setDraft((current) => current ? { ...current, ...changes } : current);
  const close = () => { if (!pending) onClose(); };
  const run = async (action: SheetAction) => {
    if (pending || (action === "record" && !canRecord)) return;
    setPending(action);
    setError(null);
    try {
      if (action === "record") await confirmRecurring(entry.id, { dueOn: entry.nextDueOn, amountMinor, occurredOn: draft.occurredOn, paymentMode: draft.paymentMode, paymentAccountId: draft.paymentMode === "online" ? draft.paymentAccountId : null });
      else if (action === "skip") await skipRecurring(entry.id, entry.nextDueOn);
      else await setRecurringActive(entry.id, false);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this recurring entry.");
    } finally {
      setPending(null);
    }
  };

  return createPortal(<AnimatedOverlay open={Boolean(entryId)} dismissOnBackdrop onClose={close} onExited={() => { setEntry(null); setDraft(null); }}>
    <section className="recurring-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="recurring-confirm-title" aria-busy={Boolean(pending)}>
      <header>
        <div>
          <span className="eyebrow">{entry.kind === "income" ? "Scheduled income" : "Scheduled bill"}</span>
          <h2 id="recurring-confirm-title">{label}</h2>
          <p>Due {formatLedgerDay(entry.nextDueOn, profile.calendarSystem, "date")} · {recurrenceLabel(entry)} · usually <span className="amount">{formatMoney(entry.amountMinor, currency)}</span></p>
        </div>
        <button className="icon-button" disabled={Boolean(pending)} onClick={close} aria-label="Close"><X size={20} /></button>
      </header>
      <div className="recurring-confirm-body">
        <div className="recurring-confirm-grid">
          <NumberInput label={`Amount in ${currency}`} value={draft.amount} min={0} decimalScale={2} thousandSeparator="," disabled={Boolean(pending)} onChange={(value) => update({ amount: String(value) })} />
          <DatePickerInput label="Date" value={draft.occurredOn} onChange={(value) => value && update({ occurredOn: value })} valueFormat="MMM D, YYYY" firstDayOfWeek={0} disabled={Boolean(pending)} required />
        </div>
        <div className="recurring-confirm-grid">
          <Select label="Payment method" value={draft.paymentMode} allowDeselect={false} disabled={Boolean(pending)}
            data={[{ value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "online", label: "Online payment" }]}
            onChange={(value) => value && update({ paymentMode: value as PaymentMode, paymentAccountId: value === "online" ? draft.paymentAccountId : "" })} />
          {draft.paymentMode === "online" && <Select label={entry.kind === "income" ? "Received in" : "Paid from"} placeholder={accounts.length ? "Choose an account" : "Add an account first"} value={draft.paymentAccountId || null} allowDeselect={false} disabled={Boolean(pending) || !accounts.length}
            data={accounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} onChange={(value) => update({ paymentAccountId: value ?? "" })} />}
        </div>
        {notDue ? <p className="recurring-confirm-hint">Not due until {formatLedgerDay(entry.nextDueOn, profile.calendarSystem, "date")}. You can record it then, or skip it now.</p>
          : <p className="recurring-confirm-hint">Changes apply to this time only. To change every future entry, edit the schedule on Plan.</p>}
        {amountMinor <= 0 && <p className="receipt-total-error">Enter an amount greater than zero.</p>}
        {accountMissing && <p className="receipt-total-error">Choose the account this {entry.kind === "income" ? "arrived in" : "was paid from"}.</p>}
        <FormError message={error} />
        <div className="recurring-confirm-actions">
          <button type="button" className="text-button" disabled={Boolean(pending)} onClick={() => void run("pause")}>{pending === "pause" ? <ButtonSpinner /> : <PauseCircle size={17} />}{pending === "pause" ? "Pausing…" : "Pause"}</button>
          <button type="button" className="secondary-button" disabled={Boolean(pending)} onClick={() => void run("skip")}>{pending === "skip" ? <ButtonSpinner /> : <SkipForward size={17} />}{pending === "skip" ? "Skipping…" : "Skip this time"}</button>
          <button type="button" className="primary-button" disabled={Boolean(pending) || !canRecord} onClick={() => void run("record")}>{pending === "record" ? <><ButtonSpinner />Recording…</> : <><Check size={17} />Record</>}</button>
        </div>
      </div>
    </section>
  </AnimatedOverlay>, document.body);
}
