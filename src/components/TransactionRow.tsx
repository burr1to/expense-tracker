import { Menu } from "@mantine/core";
import { CalendarBlank, CopySimple, DotsThree, MapPinLine, Paperclip, PencilSimple, Tag, Trash, Wallet } from "@phosphor-icons/react";
import { useContext, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatLedgerDate } from "../lib/dates";
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
  /** Without an `onEdit`, tapping the row opens the shared edit sheet (Home's compact rows). */
  tapToEdit?: boolean;
}

/** Controls inside a row (receipt preview, the ⋯ menu, an open dialog) handle their own clicks. */
const ROW_CONTROLS = "button, a, input, select, textarea, label, [role='menu'], [role='menuitem'], [role='dialog'], .modal-backdrop";

export function TransactionRow({ transaction, currency, onDuplicate, onEdit, onDelete, deletePending = false, compact = false, customCategories = [], tapToEdit = false }: TransactionRowProps) {
  const workspace = useContext(LedgerWorkspaceContext);
  const category = getCategory(transaction.category, customCategories);
  const payment = transaction.paymentMode === "online" ? transaction.paymentAccount ? paymentAccountLabel(transaction.paymentAccount) : "Online payment" : transaction.paymentMode === "cheque" ? "Cheque" : "Cash";
  const entering = workspace?.recentlyAddedTransactionId === transaction.id;
  const ownerId = workspace?.ledger.profile.id;
  const mine = !ownerId || transaction.userId === ownerId;
  const title = transaction.note || category.label;
  const edit = mine && !deletePending ? onEdit ?? (tapToEdit ? workspace?.openEdit : undefined) : undefined;
  const openFromRow = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as Element;
    // Portalled content (the ⋯ menu) still bubbles through React, so only clicks inside this row's own DOM count.
    if (!edit || !event.currentTarget.contains(target) || target.closest(ROW_CONTROLS)) return;
    edit(transaction);
  };
  const openFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!edit || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    edit(transaction);
  };
  const hasMenu = mine && !compact && Boolean(onDuplicate || onEdit || onDelete);
  return (
    <article className={`transaction-row${compact ? " compact" : ""}${entering ? " is-new" : ""}${edit ? " is-editable" : ""}${hasMenu ? " has-row-menu" : ""}`} aria-busy={deletePending} onClick={edit ? openFromRow : undefined}>
      <div className="transaction-icon" style={{ "--category-color": category.color } as CSSProperties}>
        <CategoryIcon category={transaction.category} icon={category.icon} size={21} />
      </div>
      <div className="transaction-copy">
        <strong className="transaction-title" role={edit ? "button" : undefined} tabIndex={edit ? 0 : undefined} aria-label={edit ? `Edit ${title}` : undefined} onKeyDown={edit ? openFromKeyboard : undefined}>{title}{transaction.shared ? <span className="ours-chip">Ours</span> : null}</strong>
        <div className="transaction-meta">
          <span><Tag size={13} />{category.label}{transaction.subcategory ? ` · ${transaction.subcategory}` : ""}</span>
          {transaction.area && <span><MapPinLine size={13} />{transaction.area}</span>}
          <span><Wallet size={13} />{payment}</span>
          <span><CalendarBlank size={13} />{formatLedgerDate(transaction.occurredOn, workspace?.ledger.profile.calendarSystem ?? "AD")}</span>
          {transaction.receipt && <ReceiptPreview receipt={transaction.receipt} className="row-receipt" ariaLabel={`Preview receipt ${transaction.receipt.name}`}><Paperclip size={13} />Receipt</ReceiptPreview>}
        </div>
      </div>
      <strong className={transaction.kind === "income" ? "amount income" : "amount expense"}>
        {transaction.kind === "income" ? "+" : "−"}{formatMoney(transaction.amountMinor, currency)}
      </strong>
      {hasMenu && (
        <div className="row-actions row-menu">
          <Menu position="bottom-end" shadow="md" withinPortal>
            <Menu.Target>
              <button type="button" className="icon-button" disabled={deletePending} aria-label={`More actions for ${title}`} title="More actions">{deletePending ? <ButtonSpinner /> : <DotsThree size={20} weight="bold" />}</button>
            </Menu.Target>
            <Menu.Dropdown>
              {onEdit && <Menu.Item leftSection={<PencilSimple size={16} />} onClick={() => onEdit(transaction)}>Edit</Menu.Item>}
              {onDuplicate && <Menu.Item leftSection={<CopySimple size={16} />} onClick={() => onDuplicate(transaction)}>Use again</Menu.Item>}
              {onDelete && <Menu.Item color="red" leftSection={<Trash size={16} />} onClick={() => onDelete(transaction)}>Delete</Menu.Item>}
            </Menu.Dropdown>
          </Menu>
        </div>
      )}
    </article>
  );
}
