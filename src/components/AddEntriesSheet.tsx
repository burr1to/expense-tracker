"use client";

import { DatePicker } from "@mantine/dates";
import { Menu, Popover } from "@mantine/core";
import { ArrowsLeftRight, CalendarBlank, CaretDown, ChatText, Check, FileText, Keyboard, MapPin, Money, Plus, Receipt, Trash, UsersThree, X } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useToasts } from "../context/ToastContext";
import { batchRowToDraft, batchSummary, frequentCategories, isBlankRow, newBatchRow, rowAmountValid, rowChangeFromEntry, rowIssues, suggestFromHistory, type BatchDefaults, type BatchRow } from "../lib/batch-entry";
import { getCategory, pickerCategoriesFor } from "../lib/categories";
import { formatMoney, majorToMinor } from "../lib/currency";
import { formatLedgerDate, todayInput } from "../lib/dates";
import { paymentLabel, plainAmount } from "../lib/entry-labels";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { shiftDateKey } from "../lib/transaction-defaults";
import { recentLocationsFrom } from "../lib/transaction-suggestions";
import { toUserMessage } from "../lib/user-messages";
import type { CalendarSystem, CurrencyCode, CustomCategory, CustomSubcategory, LedgerTransaction, PaymentAccount, SavedPlace, TransactionDraft, TransactionKind } from "../types";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { ButtonSpinner } from "./ButtonSpinner";
import { CategoryPickerSheet, type CategoryPick } from "./CategoryPickerSheet";
import { EntrySuggestions, useEntrySuggestions } from "./EntrySuggestions";
import { FormError } from "./FormError";
import { LocationPicker } from "./LocationPicker";
import { AccountTile, CategoryTile } from "./ToneIcon";

interface AddEntriesSheetProps {
  open: boolean;
  currency: CurrencyCode;
  calendarSystem: CalendarSystem;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  customSubcategories: CustomSubcategory[];
  paymentAccounts: PaymentAccount[];
  savedPlaces: SavedPlace[];
  ownerId?: string;
  onClose: () => void;
  /** Saves one entry; the batch saves them one by one so a failure keeps only the unsaved ones. */
  onSave: (draft: TransactionDraft) => Promise<unknown>;
  onPasteSms: () => void;
  onScanReceipt: (occurredOn: string) => void;
  onImportStatement: () => void;
  onTransfer: () => void;
  onSplitBill: () => void;
  /** The full single-entry form, for a place, receipt, group or shared entry. */
  onFullForm: (occurredOn: string) => void;
}

const QUICK = 6;
const KIND_LABEL: Record<TransactionKind, string> = { expense: "Expense", income: "Income" };
const MISSING_TILE = { "--tile-bg": "#f1f3ec", "--tile-ink": "#7b8a81", "--tile-size": "42px" } as CSSProperties;
const sanitizeAmount = (value: string) => value.replace(/[^\d.,]/g, "");

function DateMenu({ value, today, calendarSystem, onChange, label }: { value: string; today: string; calendarSystem: CalendarSystem; onChange: (date: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const quick = [0, 1, 2, 3].map((days) => shiftDateKey(today, -days));
  const text = value === today ? "Today" : value === quick[1] ? "Yesterday" : formatLedgerDate(value, calendarSystem);
  return <Popover opened={open} onChange={setOpen} position="bottom-start" shadow="md" withinPortal>
    <Popover.Target><button type="button" className="v2-pick" aria-label={`${label}: ${text}. Change`} onClick={() => setOpen((shown) => !shown)}><CalendarBlank size={17} />{text}<CaretDown size={13} weight="bold" /></button></Popover.Target>
    <Popover.Dropdown className="v2-date-pop">
      <div className="v2-date-quick">{quick.map((day, index) => <button type="button" key={day} className={day === value ? "v2-chip active" : "v2-chip"} onClick={() => { onChange(day); setOpen(false); }}>{index === 0 ? "Today" : index === 1 ? "Yesterday" : formatLedgerDate(day, calendarSystem)}</button>)}</div>
      <DatePicker value={value} maxDate={today} firstDayOfWeek={0} onChange={(next) => { if (next) { onChange(next); setOpen(false); } }} />
    </Popover.Dropdown>
  </Popover>;
}

function AccountMenu({ value, accounts, onChange, label }: { value: string; accounts: PaymentAccount[]; onChange: (id: string) => void; label: string }) {
  const current = accounts.find((account) => account.id === value) ?? null;
  const text = current ? (current.label || paymentAccountLabel(current)) : "Cash";
  return <Menu position="bottom-start" shadow="md" width={260} withinPortal>
    <Menu.Target><button type="button" className="v2-pick" aria-label={`${label}: ${text}. Change`}><AccountTile account={current} bucket={current ? undefined : "cash"} size={24} />{text}<CaretDown size={13} weight="bold" /></button></Menu.Target>
    <Menu.Dropdown>
      <Menu.Item leftSection={<AccountTile account={null} bucket="cash" size={28} />} rightSection={!value ? <Check size={15} weight="bold" /> : null} onClick={() => onChange("")}>Cash</Menu.Item>
      {accounts.map((account) => <Menu.Item key={account.id} leftSection={<AccountTile account={account} size={28} />} rightSection={value === account.id ? <Check size={15} weight="bold" /> : null} onClick={() => onChange(account.id)}>{paymentAccountLabel(account)}</Menu.Item>)}
    </Menu.Dropdown>
  </Menu>;
}

export function AddEntriesSheet(props: AddEntriesSheetProps) {
  const { open, currency, calendarSystem, transactions, customCategories, customSubcategories, paymentAccounts, savedPlaces, ownerId, onClose, onSave, onPasteSms, onScanReceipt, onImportStatement, onTransfer, onSplitBill, onFullForm } = props;
  const { push: pushToast } = useToasts();
  const today = todayInput();
  const accounts = useMemo(() => onlinePaymentAccounts(paymentAccounts).filter((account) => !ownerId || account.userId === ownerId), [ownerId, paymentAccounts]);
  const [defaults, setDefaults] = useState<BatchDefaults>({ kind: "expense", occurredOn: today, paymentMode: "cash", paymentAccountId: "" });
  // Unsaved lines stay while the sheet is closed, so catching up can happen in more than one sitting.
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [draft, setDraft] = useState<BatchRow>(() => newBatchRow({ kind: "expense", occurredOn: today, paymentMode: "cash", paymentAccountId: "" }));
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ id: string; value: CategoryPick } | null>(null);
  const [mapFor, setMapFor] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const accountChange = (id: string) => id ? { paymentMode: "online" as const, paymentAccountId: id } : { paymentMode: "cash" as const, paymentAccountId: "" };
  const accountText = (row: Pick<BatchRow, "paymentMode" | "paymentAccountId">) => {
    if (row.paymentMode !== "online") return row.paymentMode === "cheque" ? "Cheque" : "Cash";
    const account = accounts.find((item) => item.id === row.paymentAccountId);
    return account ? (account.label || paymentAccountLabel(account)) : "Choose account";
  };
  const categoriesFor = (kind: TransactionKind) => pickerCategoriesFor(kind, customCategories);
  // Switching a line between expense and income keeps its category only when the new type has it.
  const kindChange = (row: BatchRow, kind: TransactionKind): Partial<BatchRow> => categoriesFor(kind).some((category) => category.id === row.category) ? { kind } : { kind, category: "", subcategory: "", categoryChosen: false };

  const pending = isBlankRow(draft) ? [] : [draft];
  const allRows = [...rows, ...pending];
  const summary = batchSummary(allRows);
  const draftHalfDone = pending.length > 0 && !rowAmountValid(draft);
  const recentLocations = useMemo(() => recentLocationsFrom(transactions), [transactions]);
  const suggestions = useEntrySuggestions(transactions, ownerId, draft.kind, draft.note, suggestOpen && !draft.categoryChosen);
  const accountIds = useMemo(() => new Set(accounts.map((account) => account.id)), [accounts]);
  const mapTarget = mapFor === null ? null : mapFor === draft.id ? draft : rows.find((row) => row.id === mapFor) ?? null;
  const pickSuggestion = (entry: Parameters<typeof rowChangeFromEntry>[0]) => {
    setDraft((current) => ({ ...current, ...rowChangeFromEntry(entry, accountIds) }));
    setSuggestOpen(false);
    window.setTimeout(() => amountRef.current?.focus(), 0);
  };
  const setLocation = (id: string, location: BatchRow["location"]) => id === draft.id ? setDraft((current) => ({ ...current, location })) : updateRow(id, { location });

  const applyDefaults = (change: Partial<BatchDefaults>) => {
    setDefaults((current) => ({ ...current, ...change }));
    // The line being typed follows the defaults; added lines keep what they were given.
    setDraft((current) => ({ ...current, ...change }));
  };
  const changeDefaultKind = (kind: TransactionKind) => {
    setDefaults((current) => ({ ...current, kind }));
    setDraft((current) => ({ ...current, ...kindChange(current, kind) }));
  };
  const changeDraftNote = (note: string) => setDraft((current) => {
    const next = { ...current, note };
    if (current.categoryChosen) return next;
    const suggestion = suggestFromHistory(note, current.kind, transactions, ownerId);
    if (!suggestion) return { ...next, category: "", subcategory: "" };
    const accountOk = suggestion.paymentMode !== "online" || accounts.some((account) => account.id === suggestion.paymentAccountId);
    return { ...next, category: suggestion.category, subcategory: suggestion.subcategory, ...(accountOk && suggestion.paymentMode !== "cheque" ? { paymentMode: suggestion.paymentMode, paymentAccountId: suggestion.paymentAccountId } : {}) };
  });
  const addDraft = () => {
    if (!rowAmountValid(draft)) { amountRef.current?.focus(); return; }
    setRows((current) => [...current, draft]);
    setDraft(newBatchRow(defaults));
    setError("");
    window.setTimeout(() => noteRef.current?.focus(), 0);
  };
  const updateRow = (id: string, change: Partial<BatchRow>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...change } : row));
  const removeRow = (id: string) => { setRows((current) => current.filter((row) => row.id !== id)); setOpenId(null); };
  const clearAll = () => {
    if (allRows.length > 1 && !window.confirm(`Clear ${allRows.length} unsaved entries?`)) return;
    setRows([]); setDraft(newBatchRow(defaults)); setOpenId(null); setError("");
  };
  const openPicker = (row: BatchRow) => setPicking({ id: row.id, value: { kind: row.kind, category: row.category, subcategory: row.subcategory } });
  const applyPick = (pick: CategoryPick) => {
    const change = { kind: pick.kind, category: pick.category, subcategory: pick.subcategory, categoryChosen: true };
    if (picking?.id === draft.id) setDraft((current) => ({ ...current, ...change }));
    else if (picking) updateRow(picking.id, change);
    setPicking(null);
  };
  const keepSuggestion = (row: BatchRow) => row.id === draft.id ? setDraft((current) => ({ ...current, categoryChosen: true })) : updateRow(row.id, { categoryChosen: true });

  const save = async () => {
    if (draftHalfDone) { setError("Add an amount to the line you are typing, or clear it."); amountRef.current?.focus(); return; }
    if (!summary.ready || saving) return;
    setSaving(true);
    setError("");
    const batch = allRows;
    let saved = 0;
    try {
      for (const row of batch) {
        await onSave(batchRowToDraft(row));
        saved += 1;
        // Each saved line leaves the list at once, so a retry after a failure never saves it twice.
        setRows((current) => current.filter((item) => item.id !== row.id));
        if (row.id === draft.id) setDraft(newBatchRow(defaults));
      }
      pushToast({ title: `${saved} ${saved === 1 ? "entry" : "entries"} added`, tone: "success" });
      setOpenId(null);
      onClose();
    } catch (caught) {
      const kept = batch.length - saved;
      setError(toUserMessage(caught, null, `${saved ? `${saved} saved. ` : ""}${kept} ${kept === 1 ? "entry was" : "entries were"} not saved and ${kept === 1 ? "is" : "are"} still here, so you can try again.`));
    } finally {
      setSaving(false);
    }
  };

  const quick = useMemo(() => {
    const kindCategories = pickerCategoriesFor(draft.kind, customCategories);
    const ids = frequentCategories(draft.kind, transactions, ownerId);
    return [...kindCategories].sort((a, b) => (ids.indexOf(a.id) + 1 || Infinity) - (ids.indexOf(b.id) + 1 || Infinity)).slice(0, QUICK);
  }, [draft.kind, customCategories, ownerId, transactions]);

  const categoryText = (row: BatchRow) => row.category ? [getCategory(row.category, customCategories).label, row.subcategory].filter(Boolean).join(" · ") : "";
  const amountText = (row: BatchRow) => rowAmountValid(row) ? formatMoney(majorToMinor(row.amount), currency) : row.amount || "No amount";
  const tile = (row: BatchRow, size = 42) => row.category ? <CategoryTile category={row.category} custom={customCategories} size={size} /> : <span className="v2-tile" style={{ ...MISSING_TILE, "--tile-size": `${size}px` } as CSSProperties} aria-hidden="true">?</span>;
  const totalText = [summary.outMinor ? `${formatMoney(summary.outMinor, currency)} out` : "", summary.inMinor ? `${formatMoney(summary.inMinor, currency)} in` : ""].filter(Boolean).join(" · ");

  const ways = [
    { id: "type", label: "Type", icon: Keyboard, tone: ["#dcebe1", "#24503d"], run: () => noteRef.current?.focus() },
    { id: "sms", label: "Paste SMS", icon: ChatText, tone: ["#dcecf8", "#1f6f9a"], run: onPasteSms },
    { id: "statement", label: "Statement", icon: FileText, tone: ["#fdf0c4", "#8a5a00"], run: onImportStatement },
    { id: "receipt", label: "Receipt", icon: Receipt, tone: ["#fbe0ec", "#b0386a"], run: () => onScanReceipt(defaults.occurredOn) },
  ] as const;

  if (typeof document === "undefined") return null;
  return createPortal(<>
    <AnimatedOverlay open={open} className="v2-add-backdrop" leaveOnNavigate dismissOnBackdrop onClose={() => { if (!saving) onClose(); }}>
      <section className="v2-add-sheet" role="dialog" aria-modal="true" aria-labelledby="v2-add-title" aria-busy={saving}>
        <header className="v2-add-head">
          <div><span className="v2-eyebrow">{allRows.length ? `${allRows.length} not saved yet` : "Catching up"}</span><h2 id="v2-add-title">Add entries</h2></div>
          <button type="button" className="v2-icon-btn" onClick={onClose} disabled={saving} aria-label="Close. Unsaved entries stay here"><X size={20} /></button>
        </header>

        <div className="v2-add-body">
          <nav className="v2-add-ways" aria-label="Ways to add">
            {ways.map(({ id, label, icon: Icon, tone, run }) => (
              <button key={id} type="button" className={id === "type" ? "v2-way active" : "v2-way"} aria-current={id === "type" ? "true" : undefined} onClick={run}>
                <span className="v2-tile" style={{ "--tile-bg": tone[0], "--tile-ink": tone[1], "--tile-size": "40px" } as CSSProperties} aria-hidden="true"><Icon size={21} weight="duotone" /></span>{label}
              </button>
            ))}
          </nav>

          <div className="v2-add-defaults" role="group" aria-label="New entries use">
            <span className="v2-add-label">New entries use</span>
            <div className="v2-add-picks">
              <AccountMenu label="Account" value={defaults.paymentMode === "online" ? defaults.paymentAccountId : ""} accounts={accounts} onChange={(id) => applyDefaults(accountChange(id))} />
              <DateMenu label="Date" value={defaults.occurredOn} today={today} calendarSystem={calendarSystem} onChange={(occurredOn) => applyDefaults({ occurredOn })} />
              <Menu position="bottom-start" shadow="md" width={240} withinPortal>
                <Menu.Target><button type="button" className={`v2-pick is-${defaults.kind}`} aria-label={`Type: ${KIND_LABEL[defaults.kind]}. Change`}>{defaults.kind === "income" ? <Plus size={17} weight="bold" /> : <Money size={17} />}{KIND_LABEL[defaults.kind]}<CaretDown size={13} weight="bold" /></button></Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item rightSection={defaults.kind === "expense" ? <Check size={15} weight="bold" /> : null} onClick={() => changeDefaultKind("expense")}>Expense</Menu.Item>
                  <Menu.Item rightSection={defaults.kind === "income" ? <Check size={15} weight="bold" /> : null} onClick={() => changeDefaultKind("income")}>Income</Menu.Item>
                  <Menu.Divider />
                  <Menu.Item leftSection={<ArrowsLeftRight size={16} />} onClick={onTransfer}>Move money between accounts</Menu.Item>
                  <Menu.Item leftSection={<UsersThree size={16} />} onClick={onSplitBill}>Split a bill</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </div>
          </div>

          {rows.length > 0 && <ul className="v2-add-list" aria-label="Entries to save">
            {rows.map((row) => {
              const issues = rowIssues(row);
              const expanded = openId === row.id;
              const differs = [row.occurredOn !== defaults.occurredOn ? formatLedgerDate(row.occurredOn, calendarSystem) : "", row.paymentMode !== defaults.paymentMode || row.paymentAccountId !== defaults.paymentAccountId ? accountText(row) : ""].filter(Boolean);
              const title = row.note || (row.category ? getCategory(row.category, customCategories).label : "No note");
              return <li key={row.id} className={`v2-add-entry${expanded ? " is-open" : ""}${issues.length ? " has-issue" : ""}`}>
                <button type="button" className="v2-row" aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : row.id)} aria-label={`${title}, ${amountText(row)}. ${expanded ? "Close details" : "Edit details"}`}>
                  {tile(row)}
                  <span className="v2-row-main">
                    <strong>{title}</strong>
                    {issues.includes("category") ? <small className="is-warning">Choose a category</small> : issues.includes("account") ? <small className="is-warning">Choose an account</small> : <small>{categoryText(row)}{row.location ? ` · ${row.location.label}` : ""}{!row.categoryChosen && row.category ? " · suggested" : ""}</small>}
                    {differs.length > 0 && <span className="v2-add-differs">{differs.map((text) => <span key={text}>{text}</span>)}</span>}
                  </span>
                  <strong className={row.kind === "income" ? "v2-money is-in amount" : "v2-money amount"}>{row.kind === "income" ? "+" : "−"}{rowAmountValid(row) ? plainAmount(majorToMinor(row.amount)) : "No amount"}</strong>
                </button>
                {expanded && <div className="v2-add-details">
                  <div className="v2-add-inputs">
                    <input aria-label="Note" value={row.note} onChange={(event) => updateRow(row.id, { note: event.target.value })} placeholder="What was it for?" />
                    <input aria-label={`Amount in ${currency}`} inputMode="decimal" value={row.amount} onChange={(event) => updateRow(row.id, { amount: sanitizeAmount(event.target.value) })} />
                  </div>
                  <div className="v2-add-picks">
                    <button type="button" className={row.category ? "v2-pick" : "v2-pick is-missing"} onClick={() => openPicker(row)}>{row.category ? <CategoryTile category={row.category} custom={customCategories} size={24} /> : null}{categoryText(row) || "Choose a category"}<CaretDown size={13} weight="bold" /></button>
                    <AccountMenu label="Account" value={row.paymentMode === "online" ? row.paymentAccountId : ""} accounts={accounts} onChange={(id) => updateRow(row.id, accountChange(id))} />
                    <DateMenu label="Date" value={row.occurredOn} today={today} calendarSystem={calendarSystem} onChange={(occurredOn) => updateRow(row.id, { occurredOn })} />
                    <button type="button" className={row.location ? "v2-pick has-place" : "v2-pick"} onClick={() => setMapFor(row.id)}><MapPin size={17} weight={row.location ? "fill" : "regular"} />{row.location ? row.location.label : "Add place"}</button>
                    <button type="button" className={`v2-pick is-${row.kind}`} onClick={() => updateRow(row.id, kindChange(row, row.kind === "expense" ? "income" : "expense"))} aria-label={`${KIND_LABEL[row.kind]}. Switch to ${row.kind === "expense" ? "income" : "expense"}`}>{KIND_LABEL[row.kind]}</button>
                  </div>
                  <div className="v2-add-detail-actions">
                    <button type="button" className="v2-button is-danger" onClick={() => removeRow(row.id)}><Trash size={16} />Remove</button>
                    <button type="button" className="v2-button" onClick={() => setOpenId(null)}>Done</button>
                  </div>
                </div>}
              </li>;
            })}
          </ul>}

          <form className={`v2-add-draft is-${draft.kind}`} onSubmit={(event) => { event.preventDefault(); addDraft(); }}>
            <div className="v2-add-line">
              <button type="button" className="v2-add-tile" onClick={() => openPicker(draft)} aria-label={draft.category ? `Category: ${categoryText(draft)}. Change` : "Choose a category"}>{tile(draft, 46)}</button>
              <div className="entry-suggest-wrap">
                <input ref={noteRef} className="v2-add-note" aria-label="What was it for?" placeholder={draft.kind === "income" ? "Where did it come from?" : "What was it for?"} value={draft.note} autoComplete="off" onFocus={() => setSuggestOpen(true)} onBlur={() => setSuggestOpen(false)} onChange={(event) => { setSuggestOpen(true); changeDraftNote(event.target.value); }} />
                <EntrySuggestions suggestions={suggestions} customCategories={customCategories} accountText={(entry) => paymentLabel(entry, paymentAccounts)} onPick={pickSuggestion} />
              </div>
            </div>
            <div className="v2-add-line">
              <label className="v2-add-amount"><span>{currency}</span><input ref={amountRef} aria-label={`Amount in ${currency}`} inputMode="decimal" placeholder="0" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: sanitizeAmount(event.target.value) }))} /></label>
              <button type="submit" className="v2-button is-primary v2-add-next" disabled={!rowAmountValid(draft)}><Plus size={17} weight="bold" />Add</button>
            </div>
            {draft.category && !draft.categoryChosen
              ? <div className="v2-add-suggest"><button type="button" className="v2-chip is-suggested" onClick={() => keepSuggestion(draft)}><CategoryTile category={draft.category} custom={customCategories} size={24} />{categoryText(draft)}? Tap to keep</button><button type="button" className="v2-chip" onClick={() => openPicker(draft)}>Something else</button></div>
              : <div className="v2-chip-row v2-add-quick" role="group" aria-label="Category">
                {quick.map((category) => <button type="button" key={category.id} aria-pressed={draft.category === category.id} className={draft.category === category.id ? "v2-chip active" : "v2-chip"} onClick={() => setDraft((current) => ({ ...current, category: category.id, subcategory: current.category === category.id ? current.subcategory : "", categoryChosen: true }))}><CategoryTile category={category.id} custom={customCategories} size={24} />{category.label}</button>)}
                <button type="button" className="v2-chip" onClick={() => openPicker(draft)}>More…</button>
              </div>}
            <div className="v2-add-place">
              <button type="button" className={draft.location ? "v2-pick has-place" : "v2-pick"} onClick={() => setMapFor(draft.id)}><MapPin size={17} weight={draft.location ? "fill" : "regular"} />{draft.location ? draft.location.label : "Add place on map"}</button>
              {draft.location && <button type="button" className="v2-link" onClick={() => setLocation(draft.id, null)}>Remove place</button>}
            </div>
            <p className="v2-add-hint">Type what it was and the amount, then press Enter. Need a receipt or group? <button type="button" className="v2-link" onClick={() => onFullForm(draft.occurredOn)}>Use the full form</button></p>
          </form>
          <FormError message={error} />
        </div>

        <footer className="v2-add-foot">
          <div className="v2-add-total">
            <strong>{summary.count ? `${summary.count} ${summary.count === 1 ? "entry" : "entries"} ${summary.blocked ? "" : "ready"}` : "Nothing added yet"}</strong>
            <span>{summary.blocked ? <em>{summary.blocked} still {summary.blocked === 1 ? "needs" : "need"} details</em> : totalText || "Your entries show here before anything is saved"}</span>
          </div>
          {allRows.length > 0 && <button type="button" className="v2-button" onClick={clearAll} disabled={saving}>Clear</button>}
          <button type="button" className="v2-button is-primary" disabled={!summary.ready || saving} onClick={() => void save()}>{saving ? <ButtonSpinner /> : <Check size={17} weight="bold" />}{saving ? "Saving…" : `Save${summary.count > 1 ? " all" : ""}`}</button>
        </footer>
      </section>
    </AnimatedOverlay>
    <LocationPicker open={mapFor !== null} value={mapTarget?.location ?? null} recentLocations={recentLocations} savedPlaces={savedPlaces} onClose={() => setMapFor(null)} onSelect={(location) => { if (mapFor) setLocation(mapFor, location); setMapFor(null); }} />
    <CategoryPickerSheet value={picking?.value ?? null} customCategories={customCategories} customSubcategories={customSubcategories} onPick={applyPick} onClose={() => setPicking(null)} />
  </>, document.body);
}
