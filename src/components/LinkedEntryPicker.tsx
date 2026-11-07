import { Select } from "@mantine/core";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatLedgerDate } from "../lib/dates";
import type { LinkCandidate } from "../lib/due-links";
import type { CalendarSystem, CurrencyCode, CustomCategory, LedgerTransaction } from "../types";

interface Props {
  label: string;
  description?: React.ReactNode;
  candidates: LinkCandidate<LedgerTransaction>[];
  value: string | null;
  onChange: (candidate: LinkCandidate<LedgerTransaction> | null) => void;
  currency: CurrencyCode;
  calendarSystem: CalendarSystem;
  customCategories: CustomCategory[];
}

/** Picks an entry already in the ledger for a due to point at, nearest the due's date first. */
export function LinkedEntryPicker({ label, description, candidates, value, onChange, currency, calendarSystem, customCategories }: Props) {
  const entryTitle = (transaction: LedgerTransaction) => transaction.note.trim() || getCategory(transaction.category, customCategories).label;
  const data = candidates.map(({ transaction, availableMinor }) => ({
    value: transaction.id,
    label: [
      entryTitle(transaction),
      formatMoney(transaction.amountMinor, currency),
      availableMinor < transaction.amountMinor ? `${formatMoney(availableMinor, currency)} left` : null,
      formatLedgerDate(transaction.occurredOn, calendarSystem),
    ].filter(Boolean).join(" · "),
  }));
  return <Select
    label={label}
    description={description}
    placeholder={candidates.length ? "Search by note, amount or date" : "No matching entries"}
    data={data}
    value={value}
    onChange={(id) => onChange(candidates.find((candidate) => candidate.transaction.id === id) ?? null)}
    searchable
    limit={30}
    nothingFoundMessage="No entry matches"
    disabled={!candidates.length}
    required
  />;
}
