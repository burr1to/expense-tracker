"use client";

import { ClockCounterClockwise, MapPin } from "@phosphor-icons/react";
import { useMemo } from "react";
import { getCategory } from "../lib/categories";
import { plainAmount } from "../lib/entry-labels";
import { getTransactionSuggestions } from "../lib/transaction-suggestions";
import type { CustomCategory, LedgerTransaction, TransactionKind } from "../types";

/** Earlier entries that match what is being typed, most used first. Empty until something is typed. */
export function useEntrySuggestions(transactions: readonly LedgerTransaction[], ownerId: string | undefined, kind: TransactionKind, note: string, enabled: boolean) {
  const own = useMemo(() => ownerId ? transactions.filter((entry) => entry.userId === ownerId) : transactions, [ownerId, transactions]);
  return useMemo(() => enabled && note.trim() ? getTransactionSuggestions(own, kind, note, 5) : [], [enabled, kind, note, own]);
}

interface EntrySuggestionsProps {
  suggestions: ReturnType<typeof getTransactionSuggestions>;
  customCategories: CustomCategory[];
  accountText: (entry: LedgerTransaction) => string;
  onPick: (entry: LedgerTransaction) => void;
}

/** A dropdown under the note field; choosing one fills in its category, account and place too. */
export function EntrySuggestions({ suggestions, customCategories, accountText, onPick }: EntrySuggestionsProps) {
  if (!suggestions.length) return null;
  return <ul className="entry-suggest" role="listbox" aria-label="Earlier entries">
    {suggestions.map(({ transaction: entry, useCount }) => {
      const place = entry.locationLabel?.trim() || entry.area?.trim();
      const meta = [getCategory(entry.category, customCategories).label, entry.subcategory, accountText(entry)].filter(Boolean).join(" · ");
      return <li key={entry.id} role="presentation">
        {/* mouse down is held so the note field keeps focus while a suggestion is chosen */}
        <button type="button" role="option" aria-selected="false" className="entry-suggest-option" onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(entry)}>
          <ClockCounterClockwise size={18} aria-hidden="true" />
          <span className="entry-suggest-text">
            <strong>{entry.note.trim() || place || getCategory(entry.category, customCategories).label}</strong>
            <small>{meta}{place && entry.note.trim() ? <> · <MapPin size={12} weight="fill" aria-hidden="true" />{place}</> : null}</small>
          </span>
          <span className="entry-suggest-end"><span className="amount">{plainAmount(entry.amountMinor)}</span>{useCount > 1 && <small>{useCount}×</small>}</span>
        </button>
      </li>;
    })}
  </ul>;
}
