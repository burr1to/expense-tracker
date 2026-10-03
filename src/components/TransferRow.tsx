import { ArrowsLeftRight, CalendarBlank, Trash } from "@phosphor-icons/react";
import { useContext } from "react";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { formatMoney } from "../lib/currency";
import { formatLedgerDate } from "../lib/dates";
import type { AccountTransfer, CurrencyCode } from "../types";
import { ButtonSpinner } from "./ButtonSpinner";

interface TransferRowProps {
  transfer: AccountTransfer;
  fromLabel: string;
  toLabel: string;
  currency: CurrencyCode;
  onDelete?: () => void;
  deletePending?: boolean;
  compact?: boolean;
  direction?: "in" | "out";
}

export function TransferRow({ transfer, fromLabel, toLabel, currency, onDelete, deletePending = false, compact = false, direction }: TransferRowProps) {
  const workspace = useContext(LedgerWorkspaceContext);
  const ownerId = workspace?.ledger.profile.id;
  const mine = !ownerId || transfer.userId === ownerId;
  const route = `${fromLabel} → ${toLabel}`;
  const directionLabel = direction === "in" ? "Into this account" : direction === "out" ? "Out of this account" : "Transfer";
  return (
    <article className={`transaction-row transfer-entry${compact ? " compact" : ""}`} aria-busy={deletePending}>
      <div className="transaction-icon transfer-icon" aria-hidden="true">
        <ArrowsLeftRight size={21} weight="bold" />
      </div>
      <div className="transaction-copy">
        <strong className="transaction-title">{route}</strong>
        <div className="transaction-meta">
          <span><ArrowsLeftRight size={13} />{directionLabel}</span>
          {transfer.note && <span>{transfer.note}</span>}
          <span><CalendarBlank size={13} />{formatLedgerDate(transfer.occurredOn, workspace?.ledger.profile.calendarSystem ?? "AD")}</span>
        </div>
      </div>
      <strong className="amount transfer">{formatMoney(transfer.amountMinor, currency)}</strong>
      {mine && !compact && onDelete && (
        <div className="row-actions">
          <button className="icon-button danger" disabled={deletePending} onClick={onDelete} aria-label={`Delete transfer from ${fromLabel} to ${toLabel}`}>{deletePending ? <ButtonSpinner /> : <Trash size={18} />}</button>
        </div>
      )}
    </article>
  );
}
