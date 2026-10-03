"use client";

import { Modal, TextInput } from "@mantine/core";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { searchLedger } from "../lib/ledger-search";
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
}

export function LedgerSearch({ open, currency, transactions, transfers, dues, places, accounts, customCategories, onClose }: LedgerSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchLedger(query, {
    transactions,
    transfers,
    dues,
    places,
    accounts,
    categoryLabel: (category) => getCategory(category, customCategories).label,
  }), [accounts, customCategories, dues, places, query, transactions, transfers]);

  const openHit = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <Modal opened={open} onClose={onClose} title="Search the ledger" centered size="lg" classNames={{ body: "ledger-search-body" }}>
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
          <button key={`${hit.kind}-${hit.id}`} type="button" className="ledger-search-hit" role="listitem" onClick={() => openHit(hit.href)}>
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
