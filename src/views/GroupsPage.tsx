"use client";

import { CaretLeft, CaretRight, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type CSSProperties } from "react";
import { GroupFormSheet } from "../components/GroupFormSheet";
import { GroupIcon } from "../components/GroupIcon";
import { getCategory } from "../lib/categories";
import { plainAmount } from "../lib/entry-labels";
import { categoryTone } from "../lib/tones";
import { formatMoney } from "../lib/currency";
import { groupDatesText, groupEntries, groupHref, groupSpan, sortGroups, summarizeGroup } from "../lib/transaction-groups";
import type { CalendarSystem, CurrencyCode, CustomCategory, LedgerTransaction, TransactionGroup, TransactionGroupDraft } from "../types";

/** Each group keeps one colour wherever it shows: picked from its id, the same way on the detail page. */
const GROUP_TONES = [
  { bg: "#d8f1f3", ink: "#11707a" }, { bg: "#fbe0ec", ink: "#b0386a" }, { bg: "#fdf0c4", ink: "#8a5a00" },
  { bg: "#dfe6fb", ink: "#3446a8" }, { bg: "#d6f0df", ink: "#1f7a45" }, { bg: "#ece2f8", ink: "#5c2d91" },
];
const groupTileStyle = (key: string | number, size = 46) => { const seed = typeof key === "number" ? key : [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0); const tone = GROUP_TONES[seed % GROUP_TONES.length]; return { "--tile-bg": tone.bg, "--tile-ink": tone.ink, "--tile-size": `${size}px` } as CSSProperties; };

interface GroupsPageProps {
  currency: CurrencyCode;
  calendarSystem: CalendarSystem;
  groups: TransactionGroup[];
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  onCreate: (draft: TransactionGroupDraft) => Promise<string | undefined>;
}

export function GroupsPage({ currency, calendarSystem, groups, transactions, customCategories, onCreate }: GroupsPageProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const cards = useMemo(() => sortGroups(groups, transactions).map((group) => {
    const summary = summarizeGroup(groupEntries(group.id, transactions));
    return { group, summary, dates: groupDatesText(groupSpan(group, summary), calendarSystem) };
  }), [calendarSystem, groups, transactions]);

  const create = async (draft: TransactionGroupDraft) => {
    const id = await onCreate(draft);
    // A new group starts empty, so it opens on picking its entries. The dialog stays up until that page
    // replaces this one: closing it first would take its history entry back off and cancel the push.
    if (id) router.push(`${groupHref(id)}?add=1`);
    else setCreating(false);
  };

  const totalSpent = cards.reduce((sum, card) => sum + card.summary.spentMinor, 0);
  const newButton = <button type="button" className="v2-button is-primary is-compact" onClick={() => setCreating(true)}><Plus size={17} weight="bold" /><span>New group</span></button>;

  return <div className="v2-page v2-groups">
    <Link href="/transactions" className="v2-back"><CaretLeft size={16} weight="bold" />Transactions</Link>
    <header className="v2-page-head">
      <div><span className="v2-eyebrow">Trips, weddings, festivals</span><h1 id="groups-title">Groups</h1></div>
      {cards.length > 0 && <div className="v2-head-actions">{newButton}</div>}
    </header>

    {cards.length ? <>
      <section className="v2-hero v2-groups-hero" aria-label="All groups">
        <span className="v2-hero-label">Spent across {cards.length} {cards.length === 1 ? "group" : "groups"}</span>
        <strong className="v2-hero-amount amount">{formatMoney(totalSpent, currency)}</strong>
        <p className="v2-budget-hero-copy">Each entry stays in your ledger as it is. A group just keeps the story together.</p>
      </section>
      <ul className="v2-group-grid" aria-labelledby="groups-title">
        {cards.map(({ group, summary, dates }) => {
          const top = summary.categories.slice(0, 5);
          return <li key={group.id}>
            <Link className="v2-card v2-group-card" href={groupHref(group.id)}>
              <span className="v2-group-top">
                <span className="v2-tile" style={groupTileStyle(group.id)} aria-hidden="true"><GroupIcon icon={group.icon} size={24} /></span>
                <span className="v2-row-main"><strong>{group.name}</strong><small>{dates ?? "No dates yet"}</small></span>
                <CaretRight size={16} weight="bold" className="v2-group-caret" aria-hidden />
              </span>
              <span className="v2-group-total"><strong className="amount">{formatMoney(summary.spentMinor, currency)}</strong><small>{summary.count} {summary.count === 1 ? "entry" : "entries"}{summary.receivedMinor > 0 && <> · <span className="v2-money is-in">+{plainAmount(summary.receivedMinor)}</span></>}</small></span>
              {top.length > 0 && <span className="v2-group-mix" aria-label={`Biggest costs: ${top.map((item) => getCategory(item.category, customCategories).label).join(", ")}`}>
                {top.map((item) => <span key={item.category} style={{ background: categoryTone(item.category, customCategories).ink, flexGrow: item.amountMinor } as CSSProperties} />)}
              </span>}
            </Link>
          </li>;
        })}
      </ul>
    </> : <section className="v2-card v2-groups-empty">
      <div className="v2-groups-empty-icons" aria-hidden>{(["mountain", "wedding", "festival"] as const).map((icon, index) => <span key={icon} className="v2-tile" style={groupTileStyle(index, 52)}><GroupIcon icon={icon} size={26} /></span>)}</div>
      <h2>Start your first group</h2>
      <p>Name it after the trip or event, like <strong>Pokhara trip</strong> or <strong>Dashain at home</strong>, add dates if it has them, then pick the entries that belong.</p>
      {newButton}
    </section>}
    <GroupFormSheet open={creating} calendarSystem={calendarSystem} onSave={create} onClose={() => setCreating(false)} />
  </div>;
}
