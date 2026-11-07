import { Menu } from "@mantine/core";
import { ArrowsLeftRight, CalendarBlank, CopySimple, DotsThree, Folders, HandCoins, MapPinLine, Paperclip, PencilSimple, Tag, Trash, Wallet, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useContext, useMemo, type CSSProperties } from "react";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatLedgerDate } from "../lib/dates";
import { canStartLoanFrom, dueLinkLabel, dueLinksFor, loanKindFor } from "../lib/due-links";
import { paymentLabel, plainAmount, transferRoute } from "../lib/entry-labels";
import { appRoutes } from "../lib/routes";
import { groupHref } from "../lib/transaction-groups";
import type { LedgerActivityItem } from "../lib/transaction-history";
import type { AccountTransfer, CurrencyCode, CustomCategory, LedgerTransaction, PaymentAccount } from "../types";
import { ButtonSpinner } from "./ButtonSpinner";
import { ReceiptPreview } from "./ReceiptPreview";
import { CategoryTile } from "./ToneIcon";

const TRANSFER_TILE = { "--tile-bg": "#dcecf8", "--tile-ink": "#1f6f9a", "--tile-size": "42px" } as CSSProperties;

interface EntryActions {
  onEdit: (transaction: LedgerTransaction) => void;
  onDuplicate: (transaction: LedgerTransaction) => void;
  onDelete: (transaction: LedgerTransaction) => void;
  onDeleteTransfer: (transfer: AccountTransfer) => void;
}

interface EntryRowProps extends EntryActions {
  item: LedgerActivityItem;
  accounts: readonly PaymentAccount[];
  customCategories: readonly CustomCategory[];
  selected: boolean;
  deletePending: boolean;
  /** Tapping the row: open it in the side panel (desktop) or straight into the edit sheet. */
  onOpen: (item: LedgerActivityItem) => void;
}

export function EntryRow({ item, accounts, customCategories, selected, deletePending, onOpen, onEdit, onDuplicate, onDelete, onDeleteTransfer }: EntryRowProps) {
  const workspace = useContext(LedgerWorkspaceContext);
  const ownerId = workspace?.ledger.profile.id;
  const entering = item.type === "transaction" && workspace?.recentlyAddedTransactionId === item.transaction.id;
  const mine = !ownerId || (item.type === "transaction" ? item.transaction.userId : item.transfer.userId) === ownerId;

  if (item.type === "transfer") {
    const { transfer } = item;
    const route = transferRoute(transfer, accounts);
    return (
      <li className={`v2-entry${selected ? " is-selected" : ""}`} aria-busy={deletePending}>
        <button type="button" className="v2-row v2-entry-open" onClick={() => onOpen(item)} aria-pressed={selected}>
          <span className="v2-tile" style={TRANSFER_TILE} aria-hidden="true"><ArrowsLeftRight size={22} weight="bold" /></span>
          <span className="v2-row-main"><strong>{route}</strong><small>Transfer{transfer.note ? ` · ${transfer.note}` : ""}</small></span>
          <strong className="v2-money is-moved amount">{plainAmount(transfer.amountMinor)}</strong>
        </button>
        {mine && <Menu position="bottom-end" shadow="md" withinPortal>
          <Menu.Target><button type="button" className="v2-icon-btn is-quiet v2-entry-menu" disabled={deletePending} aria-label={`More actions for transfer ${route}`}>{deletePending ? <ButtonSpinner /> : <DotsThree size={20} weight="bold" />}</button></Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<PencilSimple size={16} />} onClick={() => workspace?.openTransfer({ transferId: transfer.id })}>Edit</Menu.Item>
            <Menu.Item color="red" leftSection={<Trash size={16} />} onClick={() => onDeleteTransfer(transfer)}>Delete</Menu.Item>
          </Menu.Dropdown>
        </Menu>}
      </li>
    );
  }

  const { transaction } = item;
  const category = getCategory(transaction.category, customCategories as CustomCategory[]);
  const title = transaction.note || category.label;
  const income = transaction.kind === "income";
  return (
    <li className={`v2-entry${selected ? " is-selected" : ""}${entering ? " is-new" : ""}`} aria-busy={deletePending}>
      <button type="button" className="v2-row v2-entry-open" onClick={() => onOpen(item)} aria-pressed={selected} aria-label={`${title}, ${income ? "income" : "expense"} ${plainAmount(transaction.amountMinor)}`}>
        <CategoryTile category={transaction.category} custom={customCategories} />
        <span className="v2-row-main">
          <strong>{title}{transaction.shared ? <span className="v2-ours">Ours</span> : null}</strong>
          <small>{category.label}{transaction.subcategory ? ` · ${transaction.subcategory}` : ""} · {paymentLabel(transaction, accounts)}{transaction.receipt ? " · Receipt" : ""}</small>
        </span>
        <strong className={income ? "v2-money is-in amount" : "v2-money amount"}>{income ? "+" : "−"}{plainAmount(transaction.amountMinor)}</strong>
      </button>
      {mine && <Menu position="bottom-end" shadow="md" withinPortal>
        <Menu.Target><button type="button" className="v2-icon-btn is-quiet v2-entry-menu" disabled={deletePending} aria-label={`More actions for ${title}`}>{deletePending ? <ButtonSpinner /> : <DotsThree size={20} weight="bold" />}</button></Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<PencilSimple size={16} />} onClick={() => onEdit(transaction)}>Edit</Menu.Item>
          <Menu.Item leftSection={<CopySimple size={16} />} onClick={() => onDuplicate(transaction)}>Use again</Menu.Item>
          <Menu.Item color="red" leftSection={<Trash size={16} />} onClick={() => onDelete(transaction)}>Delete</Menu.Item>
        </Menu.Dropdown>
      </Menu>}
    </li>
  );
}

interface EntryDetailProps extends EntryActions {
  item: LedgerActivityItem;
  accounts: readonly PaymentAccount[];
  customCategories: readonly CustomCategory[];
  currency: CurrencyCode;
  deletePending: boolean;
  onClose: () => void;
}

/** The selected entry, beside the list on wide screens. */
export function EntryDetail({ item, accounts, customCategories, currency, deletePending, onClose, onEdit, onDuplicate, onDelete, onDeleteTransfer }: EntryDetailProps) {
  const workspace = useContext(LedgerWorkspaceContext);
  const calendar = workspace?.ledger.profile.calendarSystem ?? "AD";
  const ownerId = workspace?.ledger.profile.id;
  const dueItems = workspace?.ledger.dueItems;
  const transaction = item.type === "transaction" ? item.transaction : null;
  const dueLinks = useMemo(() => transaction && dueItems ? dueLinksFor(transaction, dueItems) : [], [transaction, dueItems]);

  if (item.type === "transfer") {
    const { transfer } = item;
    const mine = !ownerId || transfer.userId === ownerId;
    return (
      <article className="v2-card v2-detail" aria-label="Selected transfer">
        <header className="v2-detail-head">
          <span className="v2-tile" style={{ ...TRANSFER_TILE, "--tile-size": "52px" } as CSSProperties} aria-hidden="true"><ArrowsLeftRight size={26} weight="bold" /></span>
          <button type="button" className="v2-icon-btn is-quiet" onClick={onClose} aria-label="Close details"><X size={18} /></button>
        </header>
        <h2>{transferRoute(transfer, accounts)}</h2>
        <strong className="v2-detail-amount is-moved amount">{formatMoney(transfer.amountMinor, currency)}</strong>
        <dl className="v2-detail-facts">
          <div><dt><ArrowsLeftRight size={16} />Type</dt><dd>Transfer between your accounts</dd></div>
          <div><dt><CalendarBlank size={16} />Date</dt><dd>{formatLedgerDate(transfer.occurredOn, calendar)}</dd></div>
          {transfer.note && <div><dt><Tag size={16} />Note</dt><dd>{transfer.note}</dd></div>}
        </dl>
        {mine && <div className="v2-detail-actions">
          <button type="button" className="v2-button is-primary" onClick={() => workspace?.openTransfer({ transferId: transfer.id })}><PencilSimple size={17} />Edit</button>
          <button type="button" className="v2-button is-danger" disabled={deletePending} onClick={() => onDeleteTransfer(transfer)}>{deletePending ? <ButtonSpinner /> : <Trash size={17} />}Delete</button>
        </div>}
      </article>
    );
  }

  const entry = item.transaction;
  const mine = !ownerId || entry.userId === ownerId;
  const category = getCategory(entry.category, customCategories as CustomCategory[]);
  const group = entry.groupId ? workspace?.ledger.transactionGroups.find((candidate) => candidate.id === entry.groupId) : undefined;
  const startsLoan = mine && Boolean(dueItems) && canStartLoanFrom(entry, dueLinks);
  const income = entry.kind === "income";
  return (
    <article className="v2-card v2-detail" aria-label="Selected entry">
      <header className="v2-detail-head">
        <CategoryTile category={entry.category} custom={customCategories} size={52} />
        <button type="button" className="v2-icon-btn is-quiet" onClick={onClose} aria-label="Close details"><X size={18} /></button>
      </header>
      <h2>{entry.note || category.label}{entry.shared ? <span className="v2-ours">Ours</span> : null}</h2>
      <strong className={income ? "v2-detail-amount is-in amount" : "v2-detail-amount amount"}>{income ? "+" : "−"}{formatMoney(entry.amountMinor, currency)}</strong>
      <dl className="v2-detail-facts">
        <div><dt><Tag size={16} />Category</dt><dd>{category.label}{entry.subcategory ? ` · ${entry.subcategory}` : ""}</dd></div>
        <div><dt><Wallet size={16} />Paid {income ? "into" : "from"}</dt><dd>{paymentLabel(entry, accounts)}</dd></div>
        <div><dt><CalendarBlank size={16} />Date</dt><dd>{formatLedgerDate(entry.occurredOn, calendar)}</dd></div>
        {(entry.area || entry.locationLabel) && <div><dt><MapPinLine size={16} />Place</dt><dd>{[entry.locationLabel, entry.area].filter(Boolean).join(" · ")}</dd></div>}
        {group && <div><dt><Folders size={16} />Group</dt><dd><Link href={groupHref(group.id)}>{group.name}</Link></dd></div>}
        {dueLinks.length > 0 && <div><dt><HandCoins size={16} />Due</dt><dd>{dueLinks.map((link) => <Link key={link.due.id} href={`${appRoutes.dues}?due=${link.due.id}`}>{dueLinkLabel(link)}</Link>)}</dd></div>}
        {entry.receipt && <div><dt><Paperclip size={16} />Receipt</dt><dd><ReceiptPreview receipt={entry.receipt} className="v2-detail-receipt" ariaLabel={`Preview receipt ${entry.receipt.name}`}>{entry.receipt.name}</ReceiptPreview></dd></div>}
      </dl>
      {mine && <div className="v2-detail-actions">
        <button type="button" className="v2-button is-primary" onClick={() => onEdit(entry)}><PencilSimple size={17} />Edit</button>
        <button type="button" className="v2-button" onClick={() => onDuplicate(entry)}><CopySimple size={17} />Use again</button>
        {startsLoan && <Link className="v2-button" href={`${appRoutes.dues}?link=${entry.id}`}><HandCoins size={17} />{loanKindFor(entry) === "lent" ? "Mark as lent" : "Mark as borrowed"}</Link>}
        <button type="button" className="v2-button is-danger" disabled={deletePending} onClick={() => onDelete(entry)}>{deletePending ? <ButtonSpinner /> : <Trash size={17} />}Delete</button>
      </div>}
    </article>
  );
}
