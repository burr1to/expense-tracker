import { zodResolver } from "@hookform/resolvers/zod";
import { NumberInput, SegmentedControl, Select, TextInput } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { Check, Eye, Paperclip, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { allCategoriesFor, subcategoriesFor } from "../lib/categories";
import { toDateInput } from "../lib/dates";
import { discardReceipt, uploadReceipt } from "../lib/receipts";
import { paymentAccountLabel } from "../lib/payment-accounts";
import type { CurrencyCode, CustomCategory, LedgerTransaction, PaymentAccount, PaymentMode, ReceiptUpload, TransactionDraft, TransactionKind } from "../types";
import { CategoryIcon } from "./CategoryIcon";
import { ButtonSpinner } from "./ButtonSpinner";
import { SubcategoryIcon } from "./SubcategoryIcon";
import { ReceiptPreview } from "./ReceiptPreview";

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
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  onClose: () => void;
  onSave: (draft: TransactionDraft, id?: string) => Promise<void>;
}

export function TransactionForm({ open, currency, transaction, customCategories, paymentAccounts, onClose, onSave }: TransactionFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptUpload | undefined>();
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const defaults = useMemo<TransactionDraft>(() => ({
    kind: transaction?.kind ?? "expense",
    category: transaction?.category ?? "food",
    amount: transaction ? String(transaction.amountMinor / 100) : "",
    occurredOn: transaction?.occurredOn ?? toDateInput(),
    note: transaction?.note ?? "",
    subcategory: transaction?.subcategory ?? "",
    area: transaction?.area ?? "",
    paymentMode: transaction?.paymentMode ?? "cash",
    paymentAccountId: transaction?.paymentAccountId ?? "",
  }), [transaction]);
  const { register, control, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm<TransactionDraft>({ resolver: zodResolver(schema), defaultValues: defaults });
  const kind = watch("kind");
  const category = watch("category");
  const paymentMode = watch("paymentMode");
  const subcategory = subcategoriesFor(category);
  const categoryColor = allCategoriesFor(kind, customCategories).find((item) => item.id === category)?.color ?? "#135dea";
  const discardAndClose = () => { if (receipt) void discardReceipt(receipt); onClose(); };

  useEffect(() => { reset(defaults); setSubmitError(null); setReceipt(undefined); setRemoveReceipt(false); setReceiptError(null); }, [defaults, open, reset]);

  if (!open) return null;

  const chooseKind = (nextKind: TransactionKind) => {
    setValue("kind", nextKind, { shouldValidate: true });
    const first = allCategoriesFor(nextKind, customCategories)[0];
    setValue("category", first.id, { shouldValidate: true });
    setValue("subcategory", "");
    setValue("area", "");
  };

  const submit = handleSubmit(async (draft) => {
    try {
      setSubmitError(null);
      await onSave({ ...draft, receipt, removeReceipt }, transaction?.id);
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

          <label className="amount-field">
            <span>Amount in {currency}</span>
            <div><span>{currency}</span><Controller control={control} name="amount" render={({ field }) => <NumberInput aria-label={`Amount in ${currency}`} autoFocus placeholder="0" value={field.value} onChange={(value) => field.onChange(String(value))} min={0} thousandSeparator="," decimalScale={2} error={errors.amount?.message} />} /></div>
            {errors.amount && <small className="field-error">{errors.amount.message}</small>}
          </label>

          <fieldset className="category-fieldset">
            <legend>Category</legend>
            <div className="category-grid">
              {allCategoriesFor(kind, customCategories).map((item) => (
                <button key={item.id} type="button" className={category === item.id ? "category-choice selected" : "category-choice"} onClick={() => { setValue("category", item.id, { shouldValidate: true }); setValue("subcategory", ""); setValue("area", ""); }}>
                  <span style={{ "--category-color": item.color } as CSSProperties}><CategoryIcon category={item.id} /></span>
                  {item.label}
                  {category === item.id && <Check size={15} weight="bold" />}
                </button>
              ))}
            </div>
          </fieldset>

          {subcategory.options.length ? <fieldset className="subcategory-fieldset"><legend>{subcategory.label} <span>Optional</span></legend><Controller control={control} name="subcategory" render={({ field }) => <div className="subcategory-grid">{subcategory.options.map((value) => <button key={value} type="button" className={field.value === value ? "subcategory-choice selected" : "subcategory-choice"} aria-pressed={field.value === value} onClick={() => field.onChange(field.value === value ? "" : value)}><span style={{ "--category-color": categoryColor } as CSSProperties}><SubcategoryIcon subcategory={value} /></span>{value}{field.value === value && <Check size={14} weight="bold" />}</button>)}</div>} /></fieldset> : <TextInput label={subcategory.label} description="Optional" placeholder="Add more detail" {...register("subcategory")} />}
          <TextInput label={subcategory.areaLabel ?? "Area / location"} description="Optional" placeholder={subcategory.areaPlaceholder ?? "Where did this happen?"} {...register("area")} />

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
    </div>
  );
}
