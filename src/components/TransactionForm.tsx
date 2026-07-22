import { zodResolver } from "@hookform/resolvers/zod";
import { NumberInput, SegmentedControl, Select, TextInput } from "@mantine/core";
import { Check, ClockCounterClockwise, Eye, MagnifyingGlass, MapPin, Paperclip, X } from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { allCategoriesFor, getCategory, subcategoriesFor } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { toDateInput } from "../lib/dates";
import { discardReceipt, uploadReceipt } from "../lib/receipts";
import { paymentAccountLabel } from "../lib/payment-accounts";
import { getTransactionSuggestions, type TransactionSuggestion } from "../lib/transaction-suggestions";
import type { CurrencyCode, CustomCategory, LedgerTransaction, PaymentAccount, PaymentMode, ReceiptUpload, SavedPlace, TransactionDraft, TransactionKind, TransactionLocationDraft } from "../types";
import { CategoryIcon } from "./CategoryIcon";
import { ButtonSpinner } from "./ButtonSpinner";
import { LedgerDatePickerInput as DatePickerInput } from "./LedgerDatePickerInput";
import { SubcategoryIcon } from "./SubcategoryIcon";
import { ReceiptPreview } from "./ReceiptPreview";
import { LocationPicker } from "./LocationPicker";

const schema = z.object({
  kind: z.enum(["income", "expense"]),
  category: z.string().min(1, "Choose a category"),
  amount: z.string().refine((value) => Number(value.replace(/,/g, "")) > 0, "Enter an amount greater than zero"),
  occurredOn: z.string().min(1, "Choose a date"),
  note: z.string().max(80, "Keep notes under 80 characters"),
  subcategory: z.string().max(80, "Keep the subcategory under 80 characters"),
  area: z.string().max(120, "Keep the area under 120 characters"),
  paymentMode: z.enum(["cash", "cheque", "online"]),
  paymentAccountId: z.string(),
}).superRefine((value, context) => {
  if (value.paymentMode === "online" && !value.paymentAccountId) context.addIssue({ code: "custom", path: ["paymentAccountId"], message: "Choose an online payment account" });
});

interface TransactionFormProps {
  open: boolean;
  currency: CurrencyCode;
  transaction?: LedgerTransaction | null;
  template?: LedgerTransaction | null;
  initialOccurredOn?: string;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  savedPlaces: SavedPlace[];
  onClose: () => void;
  onSave: (draft: TransactionDraft, id?: string) => Promise<void>;
}

function locationFromTransaction(transaction?: LedgerTransaction | null): TransactionLocationDraft | null {
  return transaction?.locationLatitude != null && transaction.locationLongitude != null ? {
    label: transaction.locationLabel ?? transaction.area ?? "Pinned location",
    address: transaction.locationAddress ?? "Kathmandu, Nepal",
    latitude: transaction.locationLatitude,
    longitude: transaction.locationLongitude,
    accuracy: transaction.locationAccuracy,
    source: transaction.locationSource ?? "pin",
    savedPlaceId: transaction.savedPlaceId,
  } : null;
}

export function TransactionForm({ open, currency, transaction, template, initialOccurredOn, transactions, customCategories, paymentAccounts, savedPlaces, onClose, onSave }: TransactionFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptUpload | undefined>();
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [appliedSuggestionId, setAppliedSuggestionId] = useState<string | null>(template?.id ?? null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const source = transaction ?? template;
  const defaultLocation = useMemo(() => locationFromTransaction(source), [source]);
  const recentLocations = useMemo(() => {
    const seen = new Set<string>();
    return transactions.flatMap((entry) => {
      const previous = locationFromTransaction(entry);
      if (!previous) return [];
      const key = `${previous.latitude.toFixed(5)}-${previous.longitude.toFixed(5)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [previous];
    }).slice(0, 12);
  }, [transactions]);
  const [location, setLocation] = useState<TransactionLocationDraft | null>(defaultLocation);
  const defaults = useMemo<TransactionDraft>(() => {
    return {
    kind: source?.kind ?? "expense",
    category: source?.category ?? "food",
    amount: source ? String(source.amountMinor / 100) : "",
    occurredOn: transaction?.occurredOn ?? initialOccurredOn ?? toDateInput(),
    note: source?.note ?? "",
    subcategory: source?.subcategory ?? "",
    area: source?.area ?? "",
    paymentMode: source?.paymentMode ?? "cash",
    paymentAccountId: source?.paymentAccountId ?? "",
  }; }, [initialOccurredOn, template, transaction]);
  const { register, control, handleSubmit, watch, reset, setValue, getValues, formState: { errors, isSubmitting } } = useForm<TransactionDraft>({ resolver: zodResolver(schema), defaultValues: defaults });
  const kind = watch("kind");
  const category = watch("category");
  const paymentMode = watch("paymentMode");
  const suggestions = useMemo(() => getTransactionSuggestions(transactions, kind, suggestionQuery), [kind, suggestionQuery, transactions]);
  const subcategory = subcategoriesFor(category);
  const categoryColor = allCategoriesFor(kind, customCategories).find((item) => item.id === category)?.color ?? "#147a4b";
  const discardAndClose = () => { if (receipt) void discardReceipt(receipt); onClose(); };

  useEffect(() => { reset(defaults); setLocation(defaultLocation); setLocationPickerOpen(false); setSubmitError(null); setReceipt(undefined); setRemoveReceipt(false); setReceiptError(null); setSuggestionQuery(""); setAppliedSuggestionId(template?.id ?? null); }, [defaults, defaultLocation, open, reset, template?.id]);

  if (!open) return null;

  const chooseKind = (nextKind: TransactionKind) => {
    setValue("kind", nextKind, { shouldValidate: true });
    const first = allCategoriesFor(nextKind, customCategories)[0];
    setValue("category", first.id, { shouldValidate: true });
    setValue("subcategory", "");
    setValue("area", "");
    setAppliedSuggestionId(null);
    setLocation(null);
  };

  const applySuggestion = ({ transaction: suggestion }: TransactionSuggestion) => {
    const canUseAccount = suggestion.paymentMode !== "online" || Boolean(suggestion.paymentAccountId && paymentAccounts.some((account) => account.id === suggestion.paymentAccountId));
    reset({
      kind: suggestion.kind,
      category: suggestion.category,
      amount: String(suggestion.amountMinor / 100),
      occurredOn: getValues("occurredOn") || initialOccurredOn || toDateInput(),
      note: suggestion.note,
      subcategory: suggestion.subcategory ?? "",
      area: suggestion.area ?? "",
      paymentMode: canUseAccount ? suggestion.paymentMode : "cash",
      paymentAccountId: canUseAccount ? suggestion.paymentAccountId ?? "" : "",
    });
    setLocation(locationFromTransaction(suggestion));
    setAppliedSuggestionId(suggestion.id);
  };

  const submit = handleSubmit(async (draft) => {
    try {
      setSubmitError(null);
      await onSave({ ...draft, location, receipt, removeReceipt }, transaction?.id);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not save this entry.");
    }
  });

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && discardAndClose()}>
      <section className="transaction-sheet" role="dialog" aria-modal="true" aria-labelledby="transaction-title">
        <div className="sheet-handle" />
        <header className="sheet-header">
          <div>
            <span className="eyebrow">Quick entry</span>
            <h2 id="transaction-title">{transaction ? "Edit transaction" : "Add transaction"}</h2>
          </div>
          <button className="icon-button" onClick={discardAndClose} aria-label="Close"><X size={22} /></button>
        </header>

        <form onSubmit={submit} className="transaction-form">
          <SegmentedControl fullWidth value={kind} data={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }]} onChange={(value) => chooseKind(value as TransactionKind)} />

          {!transaction && transactions.length > 0 && <section className="repeat-suggestions" aria-labelledby="repeat-suggestions-title">
            <div className="repeat-suggestions-heading">
              <div><ClockCounterClockwise size={18} weight="duotone" /><span><strong id="repeat-suggestions-title">Use a previous entry</strong><small>Prefill it, then change anything.</small></span></div>
              <TextInput aria-label="Search previous transactions" leftSection={<MagnifyingGlass size={15} />} value={suggestionQuery} onChange={(event) => setSuggestionQuery(event.currentTarget.value)} placeholder="Search place or note" size="xs" />
            </div>
            <div className="repeat-suggestion-list">
              {suggestions.map((suggestion) => {
                const previous = suggestion.transaction;
                const definition = getCategory(previous.category, customCategories);
                const payment = previous.paymentMode === "online" ? previous.paymentAccount ? paymentAccountLabel(previous.paymentAccount) : "Online" : previous.paymentMode === "cheque" ? "Cheque" : "Cash";
                return <button key={previous.id} type="button" className={appliedSuggestionId === previous.id ? "repeat-suggestion selected" : "repeat-suggestion"} aria-pressed={appliedSuggestionId === previous.id} onClick={() => applySuggestion(suggestion)}>
                  <span className="repeat-suggestion-icon" style={{ "--category-color": definition.color } as CSSProperties}><CategoryIcon category={previous.category} size={18} /></span>
                  <span className="repeat-suggestion-copy"><strong>{previous.note || previous.subcategory || definition.label}</strong><small>{definition.label}{previous.area ? ` · ${previous.area}` : ""} · {payment}</small></span>
                  <span className="repeat-suggestion-value"><strong>{formatMoney(previous.amountMinor, currency)}</strong><small>{suggestion.useCount > 1 ? `Used ${suggestion.useCount}×` : format(parseISO(previous.occurredOn), "MMM d")}</small></span>
                </button>;
              })}
              {!suggestions.length && <p className="repeat-suggestion-empty">No matching previous entries.</p>}
            </div>
          </section>}

          <label className="amount-field">
            <span>Amount in {currency}</span>
            <div><span>{currency}</span><Controller control={control} name="amount" render={({ field }) => <NumberInput aria-label={`Amount in ${currency}`} autoFocus placeholder="0" value={field.value} onChange={(value) => field.onChange(String(value))} min={0} thousandSeparator="," decimalScale={2} error={errors.amount?.message} />} /></div>
            {errors.amount && <small className="field-error">{errors.amount.message}</small>}
          </label>

          <fieldset className="category-fieldset">
            <legend>Category</legend>
            <div className="category-grid">
              {allCategoriesFor(kind, customCategories).map((item) => (
                <button key={item.id} type="button" className={category === item.id ? "category-choice selected" : "category-choice"} onClick={() => { setValue("category", item.id, { shouldValidate: true }); setValue("subcategory", ""); setValue("area", ""); setLocation(null); }}>
                  <span style={{ "--category-color": item.color } as CSSProperties}><CategoryIcon category={item.id} /></span>
                  {item.label}
                  {category === item.id && <Check size={15} weight="bold" />}
                </button>
              ))}
            </div>
          </fieldset>

          {subcategory.options.length ? <fieldset className="subcategory-fieldset"><legend>{subcategory.label} <span>Optional</span></legend><Controller control={control} name="subcategory" render={({ field }) => <div className="subcategory-grid">{subcategory.options.map((value) => <button key={value} type="button" className={field.value === value ? "subcategory-choice selected" : "subcategory-choice"} aria-pressed={field.value === value} onClick={() => field.onChange(field.value === value ? "" : value)}><span style={{ "--category-color": categoryColor } as CSSProperties}><SubcategoryIcon subcategory={value} /></span>{value}{field.value === value && <Check size={14} weight="bold" />}</button>)}</div>} /></fieldset> : <TextInput label={subcategory.label} description="Optional" placeholder="Add more detail" {...register("subcategory")} />}
          <div className="transaction-location-field">
            <Controller control={control} name="area" render={({ field }) => <TextInput label={subcategory.areaLabel ?? "Where did this happen?"} description="Optional · Kathmandu only for exact pins" placeholder={subcategory.areaPlaceholder ?? "Type an area or choose an exact location"} value={field.value} onChange={(event) => { field.onChange(event); if (location && event.currentTarget.value !== location.label) setLocation(null); }} />} />
            <button type="button" className={location ? "location-select-button selected" : "location-select-button"} onClick={() => setLocationPickerOpen(true)}><MapPin size={18} weight={location ? "fill" : "regular"} /><span><strong>{location ? "Exact location selected" : "Choose on Kathmandu map"}</strong><small>{location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : "Use current location, search, or drop a pin"}</small></span></button>
            {location && <button type="button" className="text-button danger-text clear-location-button" onClick={() => { setLocation(null); setValue("area", ""); }}>Clear exact location</button>}
          </div>

          <fieldset className="payment-fieldset">
            <legend>Mode of payment <span>Required</span></legend>
            <Controller control={control} name="paymentMode" render={({ field }) => <SegmentedControl fullWidth value={field.value} data={[{ value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "online", label: "Online payment" }]} onChange={(value) => { field.onChange(value as PaymentMode); if (value !== "online") setValue("paymentAccountId", "", { shouldValidate: true }); }} />} />
            {paymentMode === "online" && <Controller control={control} name="paymentAccountId" render={({ field }) => <Select label="Account" placeholder={paymentAccounts.length ? "Choose an account" : "Add an account in Profile settings first"} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} value={field.value || null} onChange={(value) => field.onChange(value ?? "")} allowDeselect={false} rightSection={null} required error={errors.paymentAccountId?.message} disabled={!paymentAccounts.length} />} />}
            {paymentMode === "online" && !paymentAccounts.length && <p className="field-hint">Online accounts are managed in Profile & settings.</p>}
          </fieldset>

          <div className="field-row">
            <Controller control={control} name="occurredOn" render={({ field }) => <DatePickerInput label="Date" value={field.value} onChange={(value) => field.onChange(value ?? "")} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />} />
            <TextInput label="Note" placeholder={kind === "expense" ? "What was it for?" : "Where from?"} {...register("note")} />
          </div>
          <div className="receipt-field"><label><Paperclip size={17} /><span>{receipt ? receipt.name : transaction?.receipt && !removeReceipt ? transaction.receipt.name : "Attach receipt or document"}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (!file) return; setReceiptError(null); void uploadReceipt(file).then((value) => { if (receipt) void discardReceipt(receipt); setReceipt(value); setRemoveReceipt(false); }).catch((error) => setReceiptError(error instanceof Error ? error.message : "Could not attach this file.")); }} /></label>{transaction?.receipt && !removeReceipt && !receipt && <ReceiptPreview receipt={transaction.receipt} className="text-button receipt-view-button"><Eye size={14} />Preview</ReceiptPreview>}{(receipt || transaction?.receipt) && <button type="button" className="text-button danger-text" onClick={() => { if (receipt) void discardReceipt(receipt); setReceipt(undefined); setRemoveReceipt(true); }}>Remove</button>}</div>
          <p className="field-hint">Maximum file size: 3 MB.</p>
          {receiptError && <small className="field-error">{receiptError}</small>}
          {errors.note && <small className="field-error">{errors.note.message}</small>}
          {submitError && <div className="form-error" role="alert">{submitError}</div>}
          <button className="primary-button full-width" type="submit" disabled={isSubmitting}>{isSubmitting ? <><ButtonSpinner />Saving…</> : transaction ? "Save changes" : `Add ${kind}`}</button>
        </form>
      </section>
      <LocationPicker open={locationPickerOpen} value={location} recentLocations={recentLocations} savedPlaces={savedPlaces} onClose={() => setLocationPickerOpen(false)} onSelect={(next) => { setLocation(next); setValue("area", next.label, { shouldValidate: true }); }} />
    </div>
  );
}
