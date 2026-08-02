import { CalendarBlank, CopySimple, MapPinLine, Paperclip, PencilSimple, Tag, Trash, Wallet } from "@phosphor-icons/react";
import { useContext, type CSSProperties } from "react";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatTransactionDate } from "../lib/dates";
import { paymentAccountLabel } from "../lib/payment-accounts";
import type { CurrencyCode, CustomCategory, LedgerTransaction } from "../types";
import { CategoryIcon } from "./CategoryIcon";
import { ButtonSpinner } from "./ButtonSpinner";
import { ReceiptPreview } from "./ReceiptPreview";

interface TransactionRowProps {
  transaction: LedgerTransaction;
  currency: CurrencyCode;
  onDuplicate?: (transaction: LedgerTransaction) => void;
  onEdit?: (transaction: LedgerTransaction) => void;
  onDelete?: (transaction: LedgerTransaction) => void;
  deletePending?: boolean;
  compact?: boolean;
  customCategories?: CustomCategory[];
}

export function TransactionRow({ transaction, currency, onDuplicate, onEdit, onDelete, deletePending = false, compact = false, customCategories = [] }: TransactionRowProps) {
  const workspace = useContext(LedgerWorkspaceContext);
  const category = getCategory(transaction.category, customCategories);
  const payment = transaction.paymentMode === "online" ? transaction.paymentAccount ? paymentAccountLabel(transaction.paymentAccount) : "Online payment" : transaction.paymentMode === "cheque" ? "Cheque" : "Cash";
  const entering = workspace?.recentlyAddedTransactionId === transaction.id;
  return (
    <article className={`transaction-row${compact ? " compact" : ""}${entering ? " is-new" : ""}`} aria-busy={deletePending}>
      <div className="transaction-icon" style={{ "--category-color": category.color } as CSSProperties}>
        <CategoryIcon category={transaction.category} icon={category.icon} size={21} />
      </div>
      <div className="transaction-copy">
        <strong className="transaction-title">{transaction.note || category.label}</strong>
        <div className="transaction-meta">
          <span><Tag size={13} />{category.label}{transaction.subcategory ? ` · ${transaction.subcategory}` : ""}</span>
          {transaction.area && <span><MapPinLine size={13} />{transaction.area}</span>}
          <span><Wallet size={13} />{payment}</span>
          <span><CalendarBlank size={13} />{formatTransactionDate(transaction.occurredOn)}</span>
          {transaction.receipt && <ReceiptPreview receipt={transaction.receipt} className="row-receipt" ariaLabel={`Preview receipt ${transaction.receipt.name}`}><Paperclip size={13} />Receipt</ReceiptPreview>}
        </div>
      </div>
      <strong className={transaction.kind === "income" ? "amount income" : "amount expense"}>
        {transaction.kind === "income" ? "+" : "−"}{formatMoney(transaction.amountMinor, currency)}
      </strong>
      {!compact && (onDuplicate || onEdit || onDelete) && (
        <div className="row-actions">
          {onDuplicate && <button className="icon-button" disabled={deletePending} onClick={() => onDuplicate(transaction)} aria-label={`Use ${transaction.note || category.label} again`} title="Use again"><CopySimple size={18} /></button>}
          {onEdit && <button className="icon-button" disabled={deletePending} onClick={() => onEdit(transaction)} aria-label={`Edit ${transaction.note || category.label}`}><PencilSimple size={18} /></button>}
          {onDelete && <button className="icon-button danger" disabled={deletePending} onClick={() => onDelete(transaction)} aria-label={`Delete ${transaction.note || category.label}`}>{deletePending ? <ButtonSpinner /> : <Trash size={18} />}</button>}
        </div>
      )}
    </article>
  );
}
