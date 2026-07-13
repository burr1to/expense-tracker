import { zodResolver } from "@hookform/resolvers/zod";
import { Check, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { allCategoriesFor } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { toDateInput } from "../lib/dates";
import type { CurrencyCode, CustomCategory, LedgerTransaction, TransactionDraft, TransactionKind } from "../types";
import { CategoryIcon } from "./CategoryIcon";

const schema = z.object({
  kind: z.enum(["income", "expense"]),
  category: z.string().min(1, "Choose a category"),
  amount: z.string().refine((value) => Number(value.replace(/,/g, "")) > 0, "Enter an amount greater than zero"),
  occurredOn: z.string().min(1, "Choose a date"),
  note: z.string().max(80, "Keep notes under 80 characters"),
  tags: z.string().max(120, "Keep tags under 120 characters"),
});

interface TransactionFormProps {
  open: boolean;
  currency: CurrencyCode;
  transaction?: LedgerTransaction | null;
  customCategories: CustomCategory[];
  onClose: () => void;
  onSave: (draft: TransactionDraft, id?: string) => Promise<void>;
}

export function TransactionForm({ open, currency, transaction, customCategories, onClose, onSave }: TransactionFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const defaults = useMemo<TransactionDraft>(() => ({
    kind: transaction?.kind ?? "expense",
    category: transaction?.category ?? "food",
    amount: transaction ? String(transaction.amountMinor / 100) : "",
    occurredOn: transaction?.occurredOn ?? toDateInput(),
    note: transaction?.note ?? "",
    tags: transaction?.tags.join(", ") ?? "",
  }), [transaction]);
  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm<TransactionDraft>({ resolver: zodResolver(schema), defaultValues: defaults });
  const kind = watch("kind");
  const category = watch("category");
  const amount = watch("amount");

  useEffect(() => { reset(defaults); setSubmitError(null); }, [defaults, open, reset]);

  if (!open) return null;

  const chooseKind = (nextKind: TransactionKind) => {
    setValue("kind", nextKind, { shouldValidate: true });
    const first = allCategoriesFor(nextKind, customCategories)[0];
    setValue("category", first.id, { shouldValidate: true });
  };

  const submit = handleSubmit(async (draft) => {
    try {
      setSubmitError(null);
      await onSave(draft, transaction?.id);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not save this entry.");
    }
  });

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="transaction-sheet" role="dialog" aria-modal="true" aria-labelledby="transaction-title">
        <div className="sheet-handle" />
        <header className="sheet-header">
          <div>
            <span className="eyebrow">Quick entry</span>
            <h2 id="transaction-title">{transaction ? "Edit transaction" : "Add transaction"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={22} /></button>
        </header>

        <form onSubmit={submit} className="transaction-form">
          <div className="kind-toggle">
            <button type="button" className={kind === "expense" ? "active" : ""} onClick={() => chooseKind("expense")}>Expense</button>
            <button type="button" className={kind === "income" ? "active" : ""} onClick={() => chooseKind("income")}>Income</button>
          </div>

          <label className="amount-field">
            <span>Amount in {currency}</span>
            <div><span>{currency}</span><input inputMode="decimal" autoFocus placeholder="0" {...register("amount")} /></div>
            {amount && !errors.amount && <small>{formatMoney(Math.round(Number(amount) * 100), currency)}</small>}
            {errors.amount && <small className="field-error">{errors.amount.message}</small>}
          </label>

          <fieldset className="category-fieldset">
            <legend>Category</legend>
            <div className="category-grid">
              {allCategoriesFor(kind, customCategories).map((item) => (
                <button key={item.id} type="button" className={category === item.id ? "category-choice selected" : "category-choice"} onClick={() => setValue("category", item.id, { shouldValidate: true })}>
                  <span style={{ "--category-color": item.color } as CSSProperties}><CategoryIcon category={item.id} /></span>
                  {item.label}
                  {category === item.id && <Check size={15} weight="bold" />}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="field-row">
            <label><span>Date</span><input type="date" {...register("occurredOn")} /></label>
            <label><span>Note</span><input type="text" placeholder={kind === "expense" ? "What was it for?" : "Where from?"} {...register("note")} /></label>
          </div>
          <label className="tag-field"><span>Tags <small>optional, comma separated</small></span><input type="text" placeholder="work, vacation, essential" {...register("tags")} /></label>
          {errors.note && <small className="field-error">{errors.note.message}</small>}
          {submitError && <div className="form-error" role="alert">{submitError}</div>}
          <button className="primary-button full-width" type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : transaction ? "Save changes" : `Add ${kind}`}</button>
        </form>
      </section>
    </div>
  );
}
