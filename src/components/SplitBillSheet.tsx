"use client";

import { Autocomplete, NumberInput, SegmentedControl, Select, Switch, TextInput } from "@mantine/core";
import { HandCoins, Plus, Trash, X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { spendingCategoriesFor } from "../lib/categories";
import { formatMoney, majorToMinor } from "../lib/currency";
import { formatLedgerDate, todayInput } from "../lib/dates";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { newClientRequestId } from "../lib/transaction-defaults";
import { applyBillCharges, buildSplitPlan, MAX_SPLIT_PEOPLE, personSuggestions, samePerson, SERVICE_CHARGE_PERCENT, SPLIT_DUE_AFTER_DAYS, VAT_PERCENT, type SplitBillDraft, type SplitMode } from "../lib/split-bill";
import type { CalendarSystem, CurrencyCode, CustomCategory, DueItem, PaymentAccount } from "../types";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { ButtonSpinner } from "./ButtonSpinner";
import { FormError } from "./FormError";
import type { SplitBillRequest } from "./LedgerAppLayout";
import { LedgerDatePickerInput as DatePickerInput } from "./LedgerDatePickerInput";

interface SplitBillSheetProps {
  /** null keeps the sheet closed; every new request opens a fresh form. */
  request: SplitBillRequest | null;
  currency: CurrencyCode;
  calendarSystem?: CalendarSystem;
  customCategories: CustomCategory[];
  /** Your own accounts; a split cannot be paid from someone else's. */
  paymentAccounts: PaymentAccount[];
  dueItems: DueItem[];
  onClose: () => void;
  onSave: (draft: SplitBillDraft) => Promise<void>;
}

export function SplitBillSheet({ request, ...props }: SplitBillSheetProps) {
  // The form outlives a close so it can animate out, and starts over on the next open.
  const [shown, setShown] = useState<{ key: number; request: SplitBillRequest } | null>(request ? { key: 1, request } : null);
  if (request && request !== shown?.request) setShown({ key: (shown?.key ?? 0) + 1, request });
  const [busy, setBusy] = useState(false);
  return <AnimatedOverlay open={Boolean(request)} dismissOnBackdrop onClose={() => { if (!busy) props.onClose(); }}>
    {shown && <SplitBillForm key={shown.key} request={shown.request} onBusyChange={setBusy} {...props} />}
  </AnimatedOverlay>;
}

interface PersonRow { key: string; name: string; amount: string | number }
const newRow = (name = ""): PersonRow => ({ key: newClientRequestId(), name, amount: "" });

function SplitBillForm({ request, currency, calendarSystem = "AD", customCategories, paymentAccounts, dueItems, onClose, onSave, onBusyChange }: Omit<SplitBillSheetProps, "request"> & { request: SplitBillRequest; onBusyChange: (busy: boolean) => void }) {
  const [clientRequestId] = useState(newClientRequestId);
  const [amount, setAmount] = useState<string | number>(request.amount ?? "");
  const [serviceCharge, setServiceCharge] = useState(false);
  const [vat, setVat] = useState(false);
  const [paidFrom, setPaidFrom] = useState("cash");
  const [category, setCategory] = useState("food");
  const [occurredOn, setOccurredOn] = useState(todayInput);
  const [note, setNote] = useState(request.note ?? "");
  const [includeMe, setIncludeMe] = useState(true);
  const [mode, setMode] = useState<SplitMode>("equal");
  const [myAmount, setMyAmount] = useState<string | number>("");
  const [people, setPeople] = useState<PersonRow[]>(() => request.people?.length ? request.people.map((name) => newRow(name)) : [newRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = useMemo(() => spendingCategoriesFor("expense", customCategories), [customCategories]);
  const accounts = useMemo(() => [{ value: "cash", label: "Cash" }, ...onlinePaymentAccounts(paymentAccounts).map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))], [paymentAccounts]);
  const suggestions = useMemo(() => personSuggestions(dueItems), [dueItems]);
  const bill = applyBillCharges(majorToMinor(String(amount ?? "")), { serviceCharge, vat });
  const plan = buildSplitPlan({ totalMinor: bill.totalMinor, includeMe, mode, myAmountMinor: majorToMinor(String(myAmount ?? "")), people: people.map((person) => ({ name: person.name, amountMinor: majorToMinor(String(person.amount ?? "")) })) });
  const updatePerson = (key: string, changes: Partial<PersonRow>) => setPeople((current) => current.map((person) => person.key === key ? { ...person, ...changes } : person));
  const close = () => { if (!saving) onClose(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (plan.error || saving) return;
    setSaving(true); onBusyChange(true); setError(null);
    try {
      await onSave({ clientRequestId, totalMinor: plan.totalMinor, myShareMinor: plan.myShareMinor, shares: plan.shares, category, occurredOn, note: note.trim(), paymentAccountId: paidFrom === "cash" ? null : paidFrom });
      onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save this split."); }
    finally { setSaving(false); onBusyChange(false); }
  };
  const othersLabel = plan.shares.filter((share) => share.person).map((share) => share.person).join(", ");

  return <section className="split-bill-dialog" role="dialog" aria-modal="true" aria-labelledby="split-bill-title" aria-busy={saving}>
    <header>
      <div><span className="eyebrow">Shared bill</span><h2 id="split-bill-title">Split a bill</h2></div>
      <button type="button" className="icon-button" disabled={saving} onClick={close} aria-label="Close"><X size={20} /></button>
    </header>
    <form className="split-bill-form" onSubmit={save}>
      <div className="split-bill-grid">
        <NumberInput label={`Bill amount in ${currency}`} value={amount} onChange={setAmount} min={0} decimalScale={2} thousandSeparator="," placeholder="2,400" required data-autofocus />
        <Select label="Paid from" value={paidFrom} onChange={(value) => value && setPaidFrom(value)} data={accounts} allowDeselect={false} />
      </div>
      <div className="split-bill-charges" role="group" aria-label="Charges on the bill">
        <button type="button" className={serviceCharge ? "split-charge active" : "split-charge"} aria-pressed={serviceCharge} onClick={() => setServiceCharge((value) => !value)}>+ {SERVICE_CHARGE_PERCENT}% service charge</button>
        <button type="button" className={vat ? "split-charge active" : "split-charge"} aria-pressed={vat} onClick={() => setVat((value) => !value)}>+ {VAT_PERCENT}% VAT</button>
        {(serviceCharge || vat) && <span>Total paid <strong className="split-money">{formatMoney(bill.totalMinor, currency)}</strong></span>}
      </div>
      <div className="split-bill-grid">
        <Select label="What it was for" value={category} onChange={(value) => value && setCategory(value)} data={categories.map((item) => ({ value: item.id, label: item.label }))} allowDeselect={false} searchable />
        <DatePickerInput label="Date" description={calendarSystem === "BS" && occurredOn ? formatLedgerDate(occurredOn, "BS") : undefined} value={occurredOn} onChange={(value) => value && setOccurredOn(value)} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
      </div>
      <TextInput label="Note" value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder="Momo night" maxLength={120} />

      <fieldset className="split-people">
        <legend>Who shares it</legend>
        <div className="split-people-controls">
          <SegmentedControl value={mode} onChange={(value) => setMode(value as SplitMode)} data={[{ value: "equal", label: "Equal shares" }, { value: "custom", label: "Custom amounts" }]} />
          <Switch label="Include me" checked={includeMe} onChange={(event) => setIncludeMe(event.currentTarget.checked)} />
        </div>
        {includeMe && <div className="split-person-row me"><span className="split-person-me">Me</span>{mode === "custom" ? <NumberInput aria-label="My share" value={myAmount} onChange={setMyAmount} min={0} decimalScale={2} thousandSeparator="," placeholder="0" /> : <strong className="split-money">{formatMoney(plan.myShareMinor, currency)}</strong>}<span className="split-person-spacer" aria-hidden="true" /></div>}
        {people.map((person, index) => <div className="split-person-row" key={person.key}>
          <Autocomplete aria-label={`Person ${index + 1}`} placeholder="Name" value={person.name} onChange={(value) => updatePerson(person.key, { name: value })} data={suggestions.filter((name) => samePerson(name, person.name) || !people.some((other) => samePerson(other.name, name)))} maxLength={80} limit={6} />
          {mode === "custom" ? <NumberInput aria-label={`${person.name || `Person ${index + 1}`}'s share`} value={person.amount} onChange={(value) => updatePerson(person.key, { amount: value })} min={0} decimalScale={2} thousandSeparator="," placeholder="0" /> : <strong className="split-money">{formatMoney(plan.shares[index]?.amountMinor ?? 0, currency)}</strong>}
          <button type="button" className="icon-button" disabled={people.length === 1} onClick={() => setPeople((current) => current.filter((row) => row.key !== person.key))} aria-label={`Remove ${person.name || `person ${index + 1}`}`}><Trash size={16} /></button>
        </div>)}
        <button type="button" className="text-button split-add-person" disabled={people.length >= MAX_SPLIT_PEOPLE} onClick={() => setPeople((current) => [...current, newRow()])}><Plus size={15} />Add person</button>
        {mode === "custom" && plan.unallocatedMinor !== 0 && plan.totalMinor > 0 && <p className="split-unallocated">{plan.unallocatedMinor > 0 ? "Still to assign" : "Over the bill by"} <strong className="split-money">{formatMoney(Math.abs(plan.unallocatedMinor), currency)}</strong></p>}
      </fieldset>

      <div className="split-bill-summary">
        <div><span>Your spending</span><strong className="split-money">{formatMoney(plan.myShareMinor, currency)}</strong></div>
        <div><span>Lent{othersLabel ? ` to ${othersLabel}` : ""}</span><strong className="split-money">{formatMoney(plan.othersTotalMinor, currency)}</strong></div>
      </div>
      <p className="field-hint"><HandCoins size={14} aria-hidden /> {paidFrom === "cash" ? "Cash" : accounts.find((account) => account.value === paidFrom)?.label} goes down by the whole bill. Only your share counts as spending; each person gets a Lent due, due in {SPLIT_DUE_AFTER_DAYS} days.</p>
      <FormError message={error ?? (plan.totalMinor > 0 && people.some((person) => person.name.trim()) ? plan.error : null)} />
      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={saving} onClick={close}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving || Boolean(plan.error)}>{saving ? <><ButtonSpinner />Saving…</> : "Save split"}</button>
      </div>
    </form>
  </section>;
}
