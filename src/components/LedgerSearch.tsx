"use client";

import { Modal, TextInput } from "@mantine/core";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { searchLedger, type LedgerSearchHit } from "../lib/ledger-search";
import { navigateFromOverlay, useBackToClose } from "../lib/use-back-to-close";
import type { AccountTransfer, CurrencyCode, CustomCategory, DueItem, LedgerTransaction, PaymentAccount, SavedPlace } from "../types";

interface LedgerSearchProps {
  open: boolean;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  transfers: AccountTransfer[];
  dues: DueItem[];
  places: SavedPlace[];
  accounts: PaymentAccount[];
  customCategories: CustomCategory[];
  onClose: () => void;
  /** Opens a transaction hit straight in its edit sheet; return false to fall back to the Transactions list. */
  onOpenTransaction?: (transaction: LedgerTransaction) => boolean;
}

export function LedgerSearch({ open, currency, transactions, transfers, dues, places, accounts, customCategories, onClose, onOpenTransaction }: LedgerSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [returnFocus, setReturnFocus] = useState(true);
  const [wasOpen, setWasOpen] = useState(open);
  // Re-arm focus return during render, not in an effect: flipping it after the modal opened made Mantine
  // re-capture the focused search input as the element to return to, so Escape later left focus nowhere.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReturnFocus(true);
  }
  const hits = useMemo(() => searchLedger(query, {
    transactions,
    transfers,
    dues,
    places,
    accounts,
    categoryLabel: (category) => getCategory(category, customCategories).label,
  }), [accounts, customCategories, dues, places, query, transactions, transfers]);

  const openHit = (hit: LedgerSearchHit) => {
    const transaction = hit.kind === "transaction" ? transactions.find((item) => item.id === hit.id) : undefined;
    // The edit sheet takes focus; returning it to the search button would pull it back out.
    if (transaction && onOpenTransaction?.(transaction)) {
      setReturnFocus(false);
      onClose();
    } else {
      onClose();
      navigateFromOverlay(() => router.push(hit.href));
    }
  };
  useBackToClose(open, onClose);

  return (
    <Modal opened={open} onClose={onClose} returnFocus={returnFocus} title="Search the ledger" centered size="lg" classNames={{ body: "ledger-search-body" }}>
      <TextInput
        autoFocus
        aria-label="Search the ledger"
        leftSection={<MagnifyingGlass size={16} />}
        placeholder="Note, person, place, category, or amount"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="ledger-search-results" role="list">
        {hits.map((hit) => (
          <button key={`${hit.kind}-${hit.id}`} type="button" className="ledger-search-hit" role="listitem" onClick={() => openHit(hit)}>
            <span>
              <strong>{hit.title}</strong>
              <small>{hit.kind === "transaction" ? "Transaction" : hit.kind === "transfer" ? "Transfer" : hit.kind === "due" ? "Due" : "Place"} · {hit.detail}</small>
            </span>
            {hit.amountMinor !== null && <strong className={hit.direction === "in" ? "amount income" : hit.direction === "move" ? "amount transfer" : "amount expense"}>{formatMoney(hit.amountMinor, currency)}</strong>}
          </button>
        ))}
        {query.trim() && !hits.length && <p className="ledger-search-empty">Nothing in the ledger matches that.</p>}
        {!query.trim() && <p className="ledger-search-empty">Search transactions, transfers, dues, and saved places.</p>}
      </div>
    </Modal>
  );
}
