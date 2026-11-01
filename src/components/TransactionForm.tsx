import { zodResolver } from "@hookform/resolvers/zod";
import { NumberInput, SegmentedControl, Select, Switch, TextInput } from "@mantine/core";
import { ArrowsLeftRight, CalendarBlank, Camera, CaretDown, ChatText, Check, ClockCounterClockwise, Eye, MagnifyingGlass, MapPin, Microphone, Paperclip, Sparkle, StopCircle, UsersThree, WarningCircle, X } from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { allCategoriesFor, CATEGORIES, getCategory, pickerCategoriesFor, subcategoriesFor, subcategoryOptionsFor } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatLedgerDate, todayInput } from "../lib/dates";
import { entryDateLabel, newClientRequestId, pickTransactionDefaults, shiftDateKey } from "../lib/transaction-defaults";
import { discardReceipt, uploadReceipt } from "../lib/receipts";
import { paymentAccountLabel } from "../lib/payment-accounts";
import { getTransactionSuggestions, transactionSuggestionTitle, type TransactionSuggestion } from "../lib/transaction-suggestions";
import { matchLearningSuggestion } from "../lib/learning";
import { parseVoiceTransaction, transactionWarnings } from "../lib/transaction-intelligence";
import type { CalendarSystem, CurrencyCode, CustomCategory, CustomSubcategory, LearningState, LedgerTransaction, PaymentAccount, PaymentMode, ReceiptUpload, SavedPlace, TransactionDraft, TransactionKind, TransactionLocationDraft } from "../types";
import { CategoryIcon } from "./CategoryIcon";
import { ButtonSpinner } from "./ButtonSpinner";
import { LedgerDatePickerInput as DatePickerInput } from "./LedgerDatePickerInput";
import { SubcategoryIcon } from "./SubcategoryIcon";
import { ReceiptPreview } from "./ReceiptPreview";
import { LocationPicker } from "./LocationPicker";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { FormError } from "./FormError";

const schema = z.object({
  kind: z.enum(["income", "expense"]),
  category: z.string().min(1, "Choose a category"),
  amount: z.string().refine((value) => Number(value.replace(/,/g, "")) > 0, "Enter an amount greater than zero"),
  occurredOn: z.string().min(1, "Choose a date"),
  note: z.string().max(80, "Keep notes under 80 characters"),
  subcategory: z.string().max(80, "Keep the subcategory under 80 characters"),
  area: z.string().max(120, "Keep the area under 120 characters"),
  paymentMode: z.enum(["cash", "cheque", "online"]),
  paymentAccountId: z.string(),
  shared: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.paymentMode === "online" && !value.paymentAccountId) context.addIssue({ code: "custom", path: ["paymentAccountId"], message: "Choose an online payment account" });
});

interface TransactionFormProps {
  open: boolean;
  currency: CurrencyCode;
  transaction?: LedgerTransaction | null;
  template?: LedgerTransaction | null;
  initialOccurredOn?: string;
  initialLocation?: TransactionLocationDraft | null;
  /** The kind a brand-new entry starts as (home-screen shortcuts); defaults to expense. */
  initialKind?: TransactionKind;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  customSubcategories: CustomSubcategory[];
  paymentAccounts: PaymentAccount[];
  savedPlaces: SavedPlace[];
  learning: LearningState;
  shareWithHousehold?: boolean;
  calendarSystem?: CalendarSystem;
  /** The signed-in user; smart defaults learn only from their own entries. */
  ownerId?: string;
  onClose: () => void;
  onSave: (draft: TransactionDraft, id?: string) => Promise<void>;
  /** Capture shortcuts on a new entry: the sheet closes itself, then hands over. */
  onPasteSms?: () => void;
  /** `occurredOn` is the date picked in the sheet, used for a receipt whose date cannot be read. */
  onScanReceipt?: (occurredOn?: string) => void;
  onTransfer?: (prefill: { amount?: string; occurredOn?: string; note?: string }) => void;
  onSplitBill?: (prefill: { amount?: string; note?: string }) => void;
}

interface SpeechRecognitionResultLike { 0?: { transcript?: string }; isFinal?: boolean }
interface SpeechRecognitionEventLike { results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function locationFromTransaction(transaction?: LedgerTransaction | null): TransactionLocationDraft | null {
  return transaction?.locationLatitude != null && transaction.locationLongitude != null ? {
    label: transaction.locationLabel ?? transaction.area ?? "Pinned location",
    address: transaction.locationAddress ?? "Kathmandu, Nepal",
    latitude: transaction.locationLatitude,
    longitude: transaction.locationLongitude,
    accuracy: transaction.locationAccuracy,
    source: transaction.locationSource ?? "pin",
    savedPlaceId: transaction.savedPlaceId,
  } : null;
}

export function TransactionForm({ open, currency, transaction, template, initialOccurredOn, initialLocation, initialKind = "expense", transactions, customCategories, customSubcategories, paymentAccounts, savedPlaces, learning, shareWithHousehold = false, calendarSystem = "AD", ownerId, onClose, onSave, onPasteSms, onScanReceipt, onTransfer, onSplitBill }: TransactionFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptUpload | undefined>();
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [appliedSuggestionId, setAppliedSuggestionId] = useState<string | null>(template?.id ?? null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const [personalizationMatch, setPersonalizationMatch] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clientRequestId, setClientRequestId] = useState("");
  const [pendingAction, setPendingAction] = useState<"save" | "another">("save");
  const amountRef = useRef<HTMLInputElement | null>(null);
  const dateFieldRef = useRef<HTMLDivElement>(null);
  const paymentTouched = useRef(false);
  const source = transaction ?? template;
  const freshEntry = !transaction && !template && !initialLocation;
  const recentLocations = useMemo(() => {
    const seen = new Set<string>();
    return transactions.flatMap((entry) => {
      const previous = locationFromTransaction(entry);
      if (!previous) return [];
      const key = `${previous.latitude.toFixed(5)}-${previous.longitude.toFixed(5)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [previous];
    }).slice(0, 12);
  }, [transactions]);
  const [location, setLocation] = useState<TransactionLocationDraft | null>(null);
  const smartDefaults = (forKind: TransactionKind) => {
    const choices = allCategoriesFor(forKind, customCategories);
    return pickTransactionDefaults({ transactions, kind: forKind, paymentAccounts, today: todayInput(), fallbackCategory: forKind === "expense" ? "food" : choices[0].id, categoryIds: choices.map((item) => item.id), ownerId });
  };
  const { register, control, handleSubmit, watch, reset, setValue, getValues, formState: { errors, isSubmitting } } = useForm<TransactionDraft>({ resolver: zodResolver(schema), defaultValues: { kind: "expense", category: "food", amount: "", occurredOn: todayInput(), note: "", subcategory: "", area: "", paymentMode: "cash", paymentAccountId: "", shared: false } });
  const kind = watch("kind");
  const category = watch("category");
  const paymentMode = watch("paymentMode");
  const amount = watch("amount");
  const occurredOn = watch("occurredOn");
  const note = watch("note");
  const area = watch("area");
  const paymentAccountId = watch("paymentAccountId");
  const shared = watch("shared");
  const today = todayInput();
  const dateChip = entryDateLabel(occurredOn, today, calendarSystem);
  const hasDetails = Boolean(area || location || receipt || receiptUploading || shared);
  const showDetails = Boolean(transaction) || detailsOpen || hasDetails;
  const suggestions = useMemo(() => getTransactionSuggestions(transactions, kind, suggestionQuery), [kind, suggestionQuery, transactions]);
  const subcategory = subcategoriesFor(category);
  const subcategoryOptions = subcategoryOptionsFor(category, customSubcategories);
  const categoryColor = allCategoriesFor(kind, customCategories).find((item) => item.id === category)?.color ?? "#557f69";
  const smartWarnings = useMemo(() => transactionWarnings({ kind, category, amountMinor: Math.round(Number(amount?.replace(/,/g, "")) * 100) || 0, occurredOn, note, area, paymentMode, paymentAccountId }, transactions, transaction?.id), [amount, area, category, kind, note, occurredOn, paymentAccountId, paymentMode, transaction?.id, transactions]);
  const discardAndClose = () => { if (receiptUploading) return; if (receipt) void discardReceipt(receipt); onClose(); };
  const handOff = (next: () => void) => { if (receiptUploading) return; discardAndClose(); next(); };
  const typedAmount = () => Number(getValues("amount")?.replace(/,/g, "")) > 0 ? getValues("amount").replace(/,/g, "") : undefined;

  // Set up the draft once per opening. The ledger refreshing underneath an open sheet
  // (for example after "Save & add another") must not reset what the user is typing.
  useEffect(() => {
    if (!open) {
      setLocationPickerOpen(false);
      return;
    }
    const startKind = source?.kind ?? initialKind;
    const picked = !transaction && !template && !initialLocation ? smartDefaults(startKind) : null;
    reset({
      kind: startKind,
      category: source?.category ?? picked?.category ?? (startKind === "expense" ? "food" : allCategoriesFor(startKind, customCategories)[0].id),
      amount: source ? String(source.amountMinor / 100) : "",
      occurredOn: transaction?.occurredOn ?? initialOccurredOn ?? todayInput(),
      note: source?.note ?? "",
      subcategory: source?.subcategory ?? "",
      area: source?.area ?? "",
      paymentMode: source?.paymentMode ?? picked?.paymentMode ?? "cash",
      paymentAccountId: source?.paymentAccountId ?? picked?.paymentAccountId ?? "",
      shared: source?.shared ?? false,
    });
    const nextLocation = locationFromTransaction(source) ?? initialLocation ?? null;
    setLocation(nextLocation);
    setDetailsOpen(Boolean(nextLocation || source?.area || source?.shared));
    setPendingAction("save");
    paymentTouched.current = false;
    setClientRequestId(transaction ? "" : newClientRequestId());
    setSubmitError(null);
    setReceipt(undefined);
    setRemoveReceipt(false);
    setReceiptError(null);
    setReceiptUploading(false);
    setSuggestionQuery("");
    setAppliedSuggestionId(template?.id ?? null);
    setPersonalizationMatch(null);
    setVoiceStatus(null);
    const recognition = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    setVoiceSupported(Boolean(recognition.SpeechRecognition ?? recognition.webkitSpeechRecognition));
  }, [open, transaction, template, initialOccurredOn, initialLocation, initialKind]);
  useEffect(() => () => { speechRef.current?.abort(); }, []);
  // Once a suggestion, voice or the user fills a detail, keep the section open: clearing that field must not hide it mid-edit.
  useEffect(() => { if (hasDetails) setDetailsOpen(true); }, [hasDetails]);

  const chooseKind = (nextKind: TransactionKind) => {
    setValue("kind", nextKind, { shouldValidate: true });
    const picked = freshEntry ? smartDefaults(nextKind) : null;
    setValue("category", picked?.category ?? allCategoriesFor(nextKind, customCategories)[0].id, { shouldValidate: true });
    setValue("subcategory", "");
    if (picked && !paymentTouched.current) {
      setValue("paymentMode", picked.paymentMode, { shouldValidate: true });
      setValue("paymentAccountId", picked.paymentAccountId, { shouldValidate: true });
    }
    setAppliedSuggestionId(null);
  };

  const applySuggestion = ({ transaction: suggestion }: TransactionSuggestion) => {
    const canUseAccount = suggestion.paymentMode !== "online" || Boolean(suggestion.paymentAccountId && paymentAccounts.some((account) => account.id === suggestion.paymentAccountId));
    reset({
      kind: suggestion.kind,
      category: suggestion.category,
      amount: String(suggestion.amountMinor / 100),
      occurredOn: getValues("occurredOn") || initialOccurredOn || todayInput(),
      note: suggestion.note,
      subcategory: suggestion.subcategory ?? "",
      area: suggestion.area ?? "",
      paymentMode: canUseAccount ? suggestion.paymentMode : "cash",
      paymentAccountId: canUseAccount ? suggestion.paymentAccountId ?? "" : "",
      shared: suggestion.shared ?? false,
    });
    setLocation(locationFromTransaction(suggestion));
    setAppliedSuggestionId(suggestion.id);
    paymentTouched.current = true;
  };

  const applyPersonalization = (place: string, currentKind = kind) => {
    const suggestion = matchLearningSuggestion(learning, place, currentKind);
    if (!suggestion) { setPersonalizationMatch(null); return; }
    setValue("category", suggestion.category, { shouldValidate: true });
    setValue("subcategory", suggestion.subcategory);
    setValue("paymentMode", suggestion.paymentMode, { shouldValidate: true });
    if (suggestion.paymentMode !== "online") setValue("paymentAccountId", "", { shouldValidate: true });
    setPersonalizationMatch(suggestion.place);
    paymentTouched.current = true;
  };

  const useVoiceTranscript = (transcript: string) => {
    const parsed = parseVoiceTransaction(transcript, [...CATEGORIES, ...customCategories], paymentAccounts);
    setValue("kind", parsed.kind, { shouldValidate: true });
    if (parsed.category) setValue("category", parsed.category, { shouldValidate: true });
    if (parsed.amount) setValue("amount", parsed.amount, { shouldValidate: true });
    if (parsed.occurredOn) setValue("occurredOn", parsed.occurredOn, { shouldValidate: true });
    if (parsed.paymentMode) { setValue("paymentMode", parsed.paymentMode, { shouldValidate: true }); paymentTouched.current = true; }
    if (parsed.paymentAccountId) setValue("paymentAccountId", parsed.paymentAccountId, { shouldValidate: true });
    if (parsed.area) { setValue("area", parsed.area, { shouldValidate: true }); applyPersonalization(parsed.area, parsed.kind); }
    setValue("note", parsed.transcript, { shouldValidate: true });
    setVoiceStatus("Voice captured. Review every field before saving.");
  };

  const toggleVoice = () => {
    if (voiceListening) { speechRef.current?.stop(); return; }
    const speechWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) { setVoiceStatus("Voice capture is not supported in this browser."); return; }
    const recognition = new Constructor();
    recognition.lang = "en-NP";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      if (transcript) useVoiceTranscript(transcript);
    };
    recognition.onerror = (event) => setVoiceStatus(event.error === "not-allowed" ? "Microphone permission was denied." : "Voice capture could not understand that. Try again.");
    recognition.onend = () => { setVoiceListening(false); speechRef.current = null; };
    speechRef.current = recognition;
    setVoiceStatus("Listening… Say the amount, category, place, payment method, and date. Your browser may process speech using its own speech service.");
    setVoiceListening(true);
    recognition.start();
  };

  const startAnother = (saved: TransactionDraft) => {
    reset({ ...saved, amount: "", note: "", subcategory: "", area: "" });
    setLocation(null);
    setReceipt(undefined);
    setRemoveReceipt(false);
    setReceiptError(null);
    setSuggestionQuery("");
    setAppliedSuggestionId(null);
    setPersonalizationMatch(null);
    setVoiceStatus(null);
    setDetailsOpen(Boolean(saved.shared));
    setClientRequestId(newClientRequestId());
    window.requestAnimationFrame(() => amountRef.current?.focus());
  };

  const persist = async (draft: TransactionDraft) => {
    if (receiptUploading) return false;
    try {
      setSubmitError(null);
      // The same id rides along on every retry of this draft, so a save whose response was lost is not stored twice.
      await onSave({ ...draft, location, receipt, removeReceipt, ...(transaction ? {} : { clientRequestId: clientRequestId || undefined }) }, transaction?.id);
      return true;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not save this entry.");
      return false;
    }
  };
  const submit = handleSubmit(async (draft) => { if (await persist(draft)) onClose(); });
  // Start the next entry only once handleSubmit has settled, so it begins as a fresh, unsubmitted form.
  const submitAndAddAnother = async () => {
    let saved = null as TransactionDraft | null;
    await handleSubmit(async (draft) => { if (await persist(draft)) saved = draft; })();
    if (saved && !transaction) startAnother(saved);
  };
  const openDatePicker = () => {
    const field = dateFieldRef.current;
    field?.scrollIntoView({ block: "nearest" });
    const input = field?.querySelector<HTMLButtonElement>("[data-dates-input]");
    input?.focus({ preventScroll: true });
    input?.click();
  };
  const busy = isSubmitting || receiptUploading;
  const captureShortcuts = !transaction && Boolean(onPasteSms || onScanReceipt || onTransfer || onSplitBill);

  return (
    <AnimatedOverlay open={open} dismissOnBackdrop onClose={discardAndClose}>
      <section className="transaction-sheet has-sheet-footer" role="dialog" aria-modal="true" aria-labelledby="transaction-title">
        <div className="sheet-handle" />
        <header className="sheet-header">
          <div className="sheet-heading">
            <span className="eyebrow">Quick entry</span>
            <div className="sheet-title-row">
              <h2 id="transaction-title">{transaction ? "Edit transaction" : "Add transaction"}</h2>
              <button type="button" className={dateChip.isToday ? "entry-date-chip" : "entry-date-chip is-other-day"} onClick={openDatePicker} aria-label={`Date: ${dateChip.label}. Change date`}><CalendarBlank size={14} weight={dateChip.isToday ? "regular" : "bold"} />{dateChip.label}</button>
            </div>
          </div>
          <div className="sheet-header-tools">
            {voiceSupported && !transaction && <button type="button" className={voiceListening ? "icon-button sheet-voice-button listening" : "icon-button sheet-voice-button"} aria-pressed={voiceListening} aria-label={voiceListening ? "Stop listening" : "Add with voice"} title={voiceListening ? "Stop listening" : "Add with voice"} onClick={toggleVoice}>{voiceListening ? <StopCircle size={21} weight="fill" /> : <Microphone size={21} />}</button>}
            <button className="icon-button" onClick={discardAndClose} aria-label="Close" disabled={receiptUploading}><X size={22} /></button>
          </div>
        </header>

        <form onSubmit={(event) => { setPendingAction("save"); void submit(event); }} className="transaction-form">
          {voiceStatus && <p className="sheet-voice-status" role="status">{voiceStatus}</p>}
          {captureShortcuts && <div className="capture-shortcuts" role="group" aria-label="Other ways to add">
            {onPasteSms && <button type="button" className="capture-shortcut" disabled={receiptUploading} onClick={() => handOff(onPasteSms)}><ChatText size={17} />Paste SMS</button>}
            {onScanReceipt && <button type="button" className="capture-shortcut" disabled={receiptUploading} onClick={() => handOff(() => onScanReceipt(getValues("occurredOn") || undefined))}><Camera size={17} />Scan receipt</button>}
            {onTransfer && <button type="button" className="capture-shortcut" disabled={receiptUploading} onClick={() => handOff(() => onTransfer({ amount: typedAmount(), occurredOn: getValues("occurredOn") || undefined, note: getValues("note").trim() || undefined }))}><ArrowsLeftRight size={17} />Transfer</button>}
            {onSplitBill && <button type="button" className="capture-shortcut" disabled={receiptUploading} onClick={() => handOff(() => onSplitBill({ amount: typedAmount(), note: getValues("note").trim() || undefined }))}><UsersThree size={17} />Split bill</button>}
          </div>}
          <SegmentedControl fullWidth value={kind} data={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }]} onChange={(value) => chooseKind(value as TransactionKind)} />

          {!transaction && transactions.length > 0 && <section className="repeat-suggestions" aria-labelledby="repeat-suggestions-title">
            <div className="repeat-suggestions-heading">
              <div><ClockCounterClockwise size={18} weight="duotone" /><span><strong id="repeat-suggestions-title">Use a previous entry</strong><small>Prefill it, then change anything.</small></span></div>
              <TextInput aria-label="Search previous transactions" leftSection={<MagnifyingGlass size={15} />} value={suggestionQuery} onChange={(event) => setSuggestionQuery(event.currentTarget.value)} placeholder="Search place or note" size="xs" />
            </div>
            <div className="repeat-suggestion-list">
              {suggestions.map((suggestion) => {
                const previous = suggestion.transaction;
                const definition = getCategory(previous.category, customCategories);
                const payment = previous.paymentMode === "online" ? previous.paymentAccount ? paymentAccountLabel(previous.paymentAccount) : "Online" : previous.paymentMode === "cheque" ? "Cheque" : "Cash";
                return <button key={previous.id} type="button" className={appliedSuggestionId === previous.id ? "repeat-suggestion selected" : "repeat-suggestion"} aria-pressed={appliedSuggestionId === previous.id} onClick={() => applySuggestion(suggestion)}>
                  <span className="repeat-suggestion-icon" style={{ "--category-color": definition.color } as CSSProperties}><CategoryIcon category={previous.category} icon={definition.icon} size={18} /></span>
                  <span className="repeat-suggestion-copy"><strong>{transactionSuggestionTitle(previous) || definition.label}</strong><small>{definition.label} · {payment}</small></span>
                  <span className="repeat-suggestion-value"><strong>{formatMoney(previous.amountMinor, currency)}</strong><small>{suggestion.useCount > 1 ? `Used ${suggestion.useCount}×` : format(parseISO(previous.occurredOn), "MMM d")}</small></span>
                </button>;
              })}
              {!suggestions.length && <p className="repeat-suggestion-empty">No matching previous entries.</p>}
            </div>
          </section>}

          <label className="amount-field">
            <span>Amount in {currency}</span>
            <div><span>{currency}</span><Controller control={control} name="amount" render={({ field }) => <NumberInput ref={(node) => { field.ref(node); amountRef.current = node; }} aria-label={`Amount in ${currency}`} autoFocus placeholder="0" value={field.value} onChange={(value) => field.onChange(String(value))} min={0} thousandSeparator="," decimalScale={2} error={errors.amount?.message} />} /></div>
            {errors.amount && <small className="field-error">{errors.amount.message}</small>}
          </label>

          <fieldset className="category-fieldset">
            <legend>Category</legend>
            <div className="category-grid">
              {pickerCategoriesFor(kind, customCategories).map((item) => (
                <button key={item.id} type="button" className={category === item.id ? "category-choice selected" : "category-choice"} onClick={() => { setValue("category", item.id, { shouldValidate: true }); setValue("subcategory", ""); }}>
                  <span style={{ "--category-color": item.color } as CSSProperties}><CategoryIcon category={item.id} icon={item.icon} /></span>
                  {item.label}
                  {category === item.id && <Check size={15} weight="bold" />}
                </button>
              ))}
            </div>
          </fieldset>

          {subcategoryOptions.length ? <fieldset className="subcategory-fieldset"><legend>{subcategory.label} <span>Optional</span></legend><Controller control={control} name="subcategory" render={({ field }) => <div className="subcategory-grid">{subcategoryOptions.map((option) => <button key={option.name} type="button" className={field.value === option.name ? "subcategory-choice selected" : "subcategory-choice"} aria-pressed={field.value === option.name} onClick={() => field.onChange(field.value === option.name ? "" : option.name)}><span style={{ "--category-color": categoryColor } as CSSProperties}><SubcategoryIcon subcategory={option.name} icon={option.icon} /></span>{option.name}{field.value === option.name && <Check size={14} weight="bold" />}</button>)}</div>} /></fieldset> : <TextInput label={subcategory.label} description="Optional" placeholder="Add more detail" {...register("subcategory")} />}

          <fieldset className="payment-fieldset">
            <legend>Mode of payment <span>Required</span></legend>
            <Controller control={control} name="paymentMode" render={({ field }) => <SegmentedControl fullWidth value={field.value} data={[{ value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "online", label: "Online payment" }]} onChange={(value) => { paymentTouched.current = true; field.onChange(value as PaymentMode); if (value !== "online") setValue("paymentAccountId", "", { shouldValidate: true }); }} />} />
            {paymentMode === "online" && <Controller control={control} name="paymentAccountId" render={({ field }) => <Select label="Account" placeholder={paymentAccounts.length ? "Choose an account" : "Add an account on the Accounts page first"} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} value={field.value || null} onChange={(value) => { paymentTouched.current = true; field.onChange(value ?? ""); }} allowDeselect={false} rightSection={null} required error={errors.paymentAccountId?.message} disabled={!paymentAccounts.length} />} />}
            {paymentMode === "online" && !paymentAccounts.length && <p className="field-hint">Online accounts are managed on the Accounts page.</p>}
          </fieldset>

          <div className="field-row">
            <div className="transaction-date-field" ref={dateFieldRef}>
              <Controller control={control} name="occurredOn" render={({ field }) => <DatePickerInput label="Date" description={calendarSystem === "BS" && field.value ? formatLedgerDate(field.value, "BS") : undefined} value={field.value} onChange={(value) => field.onChange(value ?? "")} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />} />
              <div className="date-quick-chips" role="group" aria-label="Quick dates">{[{ label: "Today", value: today }, { label: "Yesterday", value: shiftDateKey(today, -1) }].map((option) => <button key={option.label} type="button" className={occurredOn === option.value ? "date-quick-chip selected" : "date-quick-chip"} aria-pressed={occurredOn === option.value} onClick={() => setValue("occurredOn", option.value, { shouldValidate: true })}>{option.label}</button>)}</div>
            </div>
            <TextInput label="Note" placeholder={kind === "expense" ? "What was it for?" : "Where from?"} {...register("note")} />
          </div>
          {smartWarnings.length > 0 && <div className="transaction-warning-stack" role="status" aria-label="Smart transaction checks">{smartWarnings.map((warning) => <div className={warning.tone} key={warning.type}><WarningCircle size={18} weight="fill" /><span><strong>{warning.title}</strong><small>{warning.detail}</small></span></div>)}</div>}

          {!transaction && !hasDetails && <button type="button" className={detailsOpen ? "more-details-toggle open" : "more-details-toggle"} aria-expanded={detailsOpen} aria-controls="transaction-more-details" onClick={() => setDetailsOpen((current) => !current)}><span><strong>{detailsOpen ? "Fewer details" : "More details"}</strong><small>Place or map pin, receipt{shareWithHousehold ? ", share as Ours" : ""}</small></span><CaretDown size={16} weight="bold" /></button>}
          <div id="transaction-more-details" className="transaction-more-details" hidden={!showDetails}>
            <div className="transaction-location-field">
              <Controller control={control} name="area" render={({ field }) => <TextInput label={subcategory.areaLabel ?? "Where did this happen?"} description="Optional · Kathmandu only for exact pins" placeholder={subcategory.areaPlaceholder ?? "Type an area or choose an exact location"} value={field.value} onChange={(event) => { field.onChange(event); applyPersonalization(event.currentTarget.value); if (location && event.currentTarget.value !== location.label) setLocation(null); }} />} />
              {personalizationMatch && <div className="personalization-applied" role="status"><Sparkle size={16} /><span><strong>Personalization applied</strong><small>Category details were filled from your learned pattern for {personalizationMatch}. Review them before saving.</small></span></div>}
              <button type="button" className={location ? "location-select-button selected" : "location-select-button"} onClick={() => setLocationPickerOpen(true)}><MapPin size={18} weight={location ? "fill" : "regular"} /><span><strong>{location ? "Exact location selected" : "Choose on Kathmandu map"}</strong><small>{location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : "Use current location, search, or drop a pin"}</small></span></button>
              {location && <button type="button" className="text-button danger-text clear-location-button" onClick={() => { setLocation(null); setValue("area", ""); }}>Clear exact location</button>}
            </div>
            {shareWithHousehold && <Controller control={control} name="shared" render={({ field }) => <Switch label="Ours" description="Visible to your household. A shared online entry can use an account you both marked as shared." checked={field.value ?? false} onChange={(event) => field.onChange(event.currentTarget.checked)} />} />}
            <div className="receipt-field" aria-busy={receiptUploading}><label className={receiptUploading ? "uploading" : undefined}>{receiptUploading ? <ButtonSpinner /> : <Paperclip size={17} />}<span>{receiptUploading ? "Uploading receipt…" : receipt ? receipt.name : transaction?.receipt && !removeReceipt ? transaction.receipt.name : "Attach receipt or document"}</span><input type="file" disabled={receiptUploading} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={async (event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; setReceiptError(null); setReceiptUploading(true); try { const value = await uploadReceipt(file); if (receipt) void discardReceipt(receipt); setReceipt(value); setRemoveReceipt(false); } catch (error) { setReceiptError(error instanceof Error ? error.message : "Could not attach this file."); } finally { setReceiptUploading(false); } }} /></label>{transaction?.receipt && !removeReceipt && !receipt && !receiptUploading && <ReceiptPreview receipt={transaction.receipt} className="text-button receipt-view-button"><Eye size={14} />Preview</ReceiptPreview>}{(receipt || transaction?.receipt) && <button type="button" className="text-button danger-text" disabled={receiptUploading} onClick={() => { if (receipt) void discardReceipt(receipt); setReceipt(undefined); setRemoveReceipt(true); }}>Remove</button>}</div>
            <p className="field-hint">Maximum file size: 3 MB.</p>
            {receiptError && <small className="field-error">{receiptError}</small>}
          </div>
          {errors.note && <small className="field-error">{errors.note.message}</small>}
          <FormError message={submitError} />
          <div className="transaction-sheet-footer">
            {!transaction && <button type="button" className="secondary-button" disabled={busy} onClick={() => { setPendingAction("another"); void submitAndAddAnother(); }}>{isSubmitting && pendingAction === "another" ? <><ButtonSpinner />Saving…</> : "Save & add another"}</button>}
            <button className="primary-button" type="submit" disabled={busy}>{isSubmitting && pendingAction === "save" ? <><ButtonSpinner />Saving…</> : receiptUploading ? <><ButtonSpinner />Uploading receipt…</> : transaction ? "Save changes" : `Add ${kind}`}</button>
          </div>
        </form>
      </section>
      <LocationPicker open={locationPickerOpen} value={location} recentLocations={recentLocations} savedPlaces={savedPlaces} onClose={() => setLocationPickerOpen(false)} onSelect={(next) => { setLocation(next); setValue("area", next.label, { shouldValidate: true }); }} />
    </AnimatedOverlay>
  );
}
