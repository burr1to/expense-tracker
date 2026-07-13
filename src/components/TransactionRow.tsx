import { PencilSimple, Trash } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatTransactionDate } from "../lib/dates";
import type { CurrencyCode, CustomCategory, LedgerTransaction } from "../types";
import { CategoryIcon } from "./CategoryIcon";

interface TransactionRowProps {
  transaction: LedgerTransaction;
  currency: CurrencyCode;
  onEdit?: (transaction: LedgerTransaction) => void;
  onDelete?: (transaction: LedgerTransaction) => void;
  compact?: boolean;
  customCategories?: CustomCategory[];
}

export function TransactionRow({ transaction, currency, onEdit, onDelete, compact = false, customCategories = [] }: TransactionRowProps) {
  const category = getCategory(transaction.category, customCategories);
  return (
    <article className="transaction-row">
      <div className="transaction-icon" style={{ "--category-color": category.color } as CSSProperties}>
        <CategoryIcon category={transaction.category} size={21} />
      </div>
      <div className="transaction-copy">
        <strong>{transaction.note || category.label}</strong>
        <span>{category.label} · {formatTransactionDate(transaction.occurredOn)}{transaction.tags.length ? ` · #${transaction.tags.join(" #")}` : ""}</span>
      </div>
      <strong className={transaction.kind === "income" ? "amount income" : "amount expense"}>
        {transaction.kind === "income" ? "+" : "−"}{formatMoney(transaction.amountMinor, currency)}
      </strong>
      {!compact && (onEdit || onDelete) && (
        <div className="row-actions">
          {onEdit && <button className="icon-button" onClick={() => onEdit(transaction)} aria-label={`Edit ${transaction.note || category.label}`}><PencilSimple size={18} /></button>}
          {onDelete && <button className="icon-button danger" onClick={() => onDelete(transaction)} aria-label={`Delete ${transaction.note || category.label}`}><Trash size={18} /></button>}
        </div>
      )}
    </article>
  );
}
