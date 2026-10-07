"use client";

import { NumberInput, Select, Textarea, TextInput } from "@mantine/core";
import { ArrowsLeftRight, CheckCircle, ClipboardText, Info, Sparkle, WarningCircle, X, ChatText } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { pickerCategoriesFor, spendingCategoriesFor, subcategoryOptionsFor } from "../lib/categories";
import { majorToMinor } from "../lib/currency";
import { formatLedgerDate, todayInput } from "../lib/dates";
import { findSimilarTransfer, isCashAccount, onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { personalizeSmsAnalysis, smsDefaultCategory, smsResultToDraft, withSmsAccountMatch, type SmsAnalysis } from "../lib/sms-analysis";
import { mentionsCurrencyAmount, mentionsOneTimeCode, parseBankSms, SMS_MAX_LENGTH } from "../lib/sms-templates";
import { transactionWarnings } from "../lib/transaction-intelligence";
import { readResponse, responseMessage, toUserMessage } from "../lib/user-messages";
import type {
  AccountTransfer, AccountTransferDraft, CalendarSystem, CurrencyCode, CustomCategory, CustomSubcategory, LearningState, LedgerTransaction,
  PaymentAccount, PaymentMode, TransactionDraft, TransactionKind,
} from "../types";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { ButtonSpinner } from "./ButtonSpinner";
import { LedgerDatePickerInput as DatePickerInput } from "./LedgerDatePickerInput";
import { FormError } from "./FormError";

interface SmsCaptureProps {
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  customSubcategories: CustomSubcategory[];
  paymentAccounts: PaymentAccount[];
  learning: LearningState;
  onSave: (draft: TransactionDraft) => Promise<string | undefined>;
  /** Controlled mode: the workspace opens this sheet from anywhere (Add sheet, share target). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Message text to prefill when the sheet opens, e.g. from the share target. */
  initialText?: string;
  /** Render the "Paste bank SMS" trigger button. Defaults to true. */
  showTrigger?: boolean;
  /** Shows the Bikram Sambat date beside the date picker when the user reads dates in BS. */
  calendarSystem?: CalendarSystem;
  /** The signed-in user. Only their own accounts and entries are used to read a message. */
  ownerId?: string;
  /** Saves a "Transfer between my accounts" reading. Without it, review offers only Expense and Income. */
  onSaveTransfer?: (draft: AccountTransferDraft) => Promise<void>;
  /** Recorded transfers, so the second alert for one wallet load or ATM withdrawal is flagged before it moves the money twice. */
  transfers?: AccountTransfer[];
}

type Stage = "ready" | "parsing" | "reviewing" | "saving" | "saved";
type ReviewType = TransactionKind | "transfer";
interface TransferRoute { fromAccountId: string; toAccountId: string }

export function SmsCapture({ currency, transactions, customCategories, customSubcategories, paymentAccounts, learning, onSave, open: openProp, onOpenChange, initialText, showTrigger = true, calendarSystem = "AD", ownerId, onSaveTransfer, transfers = [] }: SmsCaptureProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [stage, setStage] = useState<Stage>("ready");
  const [message, setMessage] = useState("");
  const [analysis, setAnalysis] = useState<SmsAnalysis | null>(null);
  const [draft, setDraft] = useState<TransactionDraft | null>(null);
  const [reviewType, setReviewType] = useState<ReviewType>("expense");
  const [route, setRoute] = useState<TransferRoute>({ fromAccountId: "", toAccountId: "" });
  const [error, setError] = useState<string | null>(null);
  const [personalizedNote, setPersonalizedNote] = useState<string | null>(null);
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const [savedAs, setSavedAs] = useState<"transaction" | "transfer">("transaction");
  const requestRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);

  useEffect(() => {
    if (open && initialText) setMessage(initialText);
  }, [open, initialText]);

  // A message is the user's own: match it against their accounts and habits, never a partner's.
  const ownAccounts = useMemo(() => ownerId ? paymentAccounts.filter((account) => account.userId === ownerId) : paymentAccounts, [ownerId, paymentAccounts]);
  const onlineAccounts = useMemo(() => onlinePaymentAccounts(ownAccounts), [ownAccounts]);
  const ownTransactions = useMemo(() => ownerId ? transactions.filter((transaction) => transaction.userId === ownerId) : transactions, [ownerId, transactions]);
  const transferOptions = useMemo(() => ownAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) })), [ownAccounts]);
  const categories = useMemo(
    () => pickerCategoriesFor(draft?.kind ?? "expense", customCategories),
    [draft?.kind, customCategories],
  );

  const duplicateWarnings = useMemo(() => {
    if (!draft) return [];
    const amountMinor = majorToMinor(draft.amount);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return [];
    return transactionWarnings({
      kind: draft.kind,
      category: draft.category,
      amountMinor,
      occurredOn: draft.occurredOn,
      note: draft.note,
      area: draft.area,
      paymentMode: draft.paymentMode,
      paymentAccountId: draft.paymentAccountId,
    }, transactions);
  }, [draft, transactions]);

  useEffect(() => () => {
    operationRef.current += 1;
    requestRef.current?.abort();
  }, []);

  const reset = () => {
    setMessage("");
    setAnalysis(null);
    setDraft(null);
    setError(null);
    setPersonalizedNote(null);
    setPasteHint(null);
    setStage("ready");
  };

  const close = () => {
    if (stage === "saving") return;
    operationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    setOpen(false);
    reset();
  };

  /** Fills what the message cannot state from the user's habits, and starts review on the right type. */
  const startReview = (reading: SmsAnalysis) => {
    // Loans are recorded from Dues, so a past loan entry with this person never fills the category.
    const categoryIds = spendingCategoriesFor(reading.draft.kind, customCategories).map((category) => category.id);
    const { analysis: result, note } = personalizeSmsAnalysis(reading, learning, ownTransactions, categoryIds);
    // Each reading gets its own request id, so a retried save records it once.
    const draftWithId = { ...result.draft, clientRequestId: crypto.randomUUID() };
    setPersonalizedNote(note);
    setAnalysis({ ...result, draft: draftWithId });
    setDraft(draftWithId);
    setRoute({ fromAccountId: result.transfer?.fromAccountId ?? "", toAccountId: result.transfer?.toAccountId ?? "" });
    setReviewType(onSaveTransfer && result.transfer?.startAsTransfer ? "transfer" : result.draft.kind);
    setStage("reviewing");
  };

  /** `askGemini` is false when the text came straight from the clipboard: only the on-device parser may read it then. */
  const read = async (input = message, askGemini = true) => {
    const text = input.trim();
    if (!text) return;
    const operation = ++operationRef.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setPersonalizedNote(null);
    setPasteHint(null);
    setStage("parsing");

    // The offline parser handles the common formats instantly and without
    // sending the message anywhere. Gemini is only asked about messages it
    // cannot read.
    const offline = parseBankSms(text, todayInput());
    if (offline) {
      startReview(smsResultToDraft(offline, todayInput(), ownAccounts));
      requestRef.current = null;
      return;
    }
    if (!askGemini) {
      requestRef.current = null;
      setStage("ready");
      setPasteHint("Pasted, but this could not be read on your device. Check it, then tap Read message to send it to Gemini.");
      return;
    }

    try {
      const response = await fetch("/api/imports/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const parsed = await readResponse<{ analysis?: SmsAnalysis; error?: string }>(response);
      if (operation !== operationRef.current) return;
      if (!response.ok || !parsed.body?.analysis) throw new Error(responseMessage(parsed, "Could not read this message."));
      // Gemini reads amount, date and category; the account still comes from the message itself.
      startReview(withSmsAccountMatch(parsed.body.analysis, text, ownAccounts));
    } catch (caught) {
      const cancelled = caught instanceof Error && caught.name === "AbortError";
      if (!cancelled && operation === operationRef.current) {
        setError(toUserMessage(caught, null, "Could not read this message."));
        setStage("ready");
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const update = (changes: Partial<TransactionDraft>) => {
    setDraft((current) => current ? { ...current, ...changes } : current);
  };

  const asTransfer = reviewType === "transfer";
  const amountIsValid = Boolean(draft && Number(draft.amount.replace(/,/g, "")) > 0);
  const accountIsMissing = !asTransfer && draft?.paymentMode === "online" && !draft.paymentAccountId;
  const routeIsMissing = asTransfer && (!route.fromAccountId || !route.toAccountId || route.fromAccountId === route.toAccountId);
  const canSave = Boolean(draft && amountIsValid && !accountIsMissing && !routeIsMissing && stage === "reviewing");
  // The bank and the wallet each send an alert for one load, so the second one often names a transfer already saved.
  const similarTransfer = asTransfer && draft && !routeIsMissing ? findSimilarTransfer(transfers, { ...route, amountMinor: majorToMinor(draft.amount), occurredOn: draft.occurredOn }) : null;
  const routeLabel = (id: string) => transferOptions.find((option) => option.value === id)?.label ?? "the account";

  const changeReviewType = (value: ReviewType) => {
    setReviewType(value);
    if (value !== "transfer" && draft && value !== draft.kind) update({ kind: value, category: smsDefaultCategory(value), subcategory: "" });
  };

  const save = async () => {
    if (!canSave || !draft) return;
    setStage("saving");
    setError(null);
    try {
      if (asTransfer && onSaveTransfer) await onSaveTransfer({ ...route, amount: draft.amount, occurredOn: draft.occurredOn, note: draft.note, clientRequestId: draft.clientRequestId });
      else await onSave(draft);
      setSavedAs(asTransfer ? "transfer" : "transaction");
      setAnalysis(null);
      setDraft(null);
      setMessage("");
      setStage("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : asTransfer ? "Could not record this transfer." : "Could not save this transaction.");
      setStage("reviewing");
    }
  };

  /** Reads the clipboard and the message in one tap; some browsers refuse, so the box stays as the fallback. */
  const pasteFromClipboard = async () => {
    setError(null);
    setPasteHint(null);
    try {
      const text = typeof navigator !== "undefined" && navigator.clipboard?.readText ? (await navigator.clipboard.readText()).slice(0, SMS_MAX_LENGTH) : null;
      if (text === null) throw new Error("Clipboard reading is not available.");
      if (!text.trim()) { setPasteHint("Your clipboard is empty. Copy the bank SMS first, or long-press the box below to paste."); return; }
      // A one-time code is never pasted, even when its message names the amount it approves.
      if (mentionsOneTimeCode(text)) { setPasteHint("Your clipboard holds a one-time code, not a bank alert, so nothing was pasted. Copy the transaction SMS instead."); return; }
      setMessage(text);
      // Clipboard text is read on the device only; Gemini sees it only after the user taps Read message.
      if (mentionsCurrencyAmount(text)) await read(text, false);
      else setPasteHint("Pasted, but this does not look like a bank alert. Check it, then tap Read message.");
    } catch {
      setPasteHint("This browser did not share the clipboard. Long-press the box below to paste.");
    }
  };

  const pasteAnother = () => {
    reset();
    void pasteFromClipboard();
  };

  const subcategories = draft ? subcategoryOptionsFor(draft.category, customSubcategories) : [];

  return <>
    {showTrigger && <button className="secondary-button sms-capture-trigger" onClick={() => setOpen(true)}>
      <ChatText size={18} />Paste bank SMS
    </button>}
    <AnimatedOverlay open={open} dismissOnBackdrop onClose={close}>
      <section className="sms-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="sms-capture-title" aria-busy={stage === "parsing" || stage === "saving"}>
        <header>
          <div>
            <span className="eyebrow">Quick capture</span>
            <h2 id="sms-capture-title">{stage === "reviewing" || stage === "saving" ? "Review before saving" : stage === "saved" ? "Saved" : "Paste a bank message"}</h2>
          </div>
          <button className="icon-button" disabled={stage === "saving"} onClick={close} aria-label="Close"><X size={20} /></button>
        </header>

        {stage === "saved" ? <div className="sms-capture-step sms-saved-step" role="status">
          <span className="sms-saved-icon" aria-hidden="true"><CheckCircle size={30} weight="fill" /></span>
          <p><strong>Saved. Paste another?</strong> {savedAs === "transfer" ? "The transfer is recorded and both balances are updated." : "The entry is in your ledger."} Copy the next alert from your messages, then tap below.</p>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={close}>Done</button>
            <button className="primary-button" onClick={pasteAnother}><ClipboardText size={17} />Paste another</button>
          </div>
        </div> : stage !== "reviewing" && stage !== "saving" ? <div className="sms-capture-step">
          <p>Paste the confirmation SMS from your bank or wallet. Most messages are read on your device without leaving it; only an unrecognised format is sent to Gemini.</p>
          <button type="button" className="secondary-button full-width sms-paste-button" disabled={stage === "parsing"} onClick={() => void pasteFromClipboard()}><ClipboardText size={18} />Paste from clipboard</button>
          {pasteHint && <p className="sms-paste-hint" role="status"><Info size={15} aria-hidden />{pasteHint}</p>}
          <Textarea
            label="Message"
            placeholder="Your A/C XXXXXX4821 is debited by NPR 1,250.00 on 12/08/2026 at ..."
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
            maxLength={SMS_MAX_LENGTH}
            autosize
            minRows={4}
            maxRows={10}
          />
          <FormError message={error} />
          <button className="primary-button full-width" disabled={!message.trim() || stage === "parsing"} onClick={() => void read()}>
            {stage === "parsing" ? <><ButtonSpinner />Reading…</> : <><Sparkle size={17} />Read message</>}
          </button>
        </div> : draft && analysis && <div className="sms-review-step">
          <section className="sms-review-summary">
            <div><span>Read by</span><strong>{analysis.source === "template" ? "On-device parser" : "Gemini"}</strong></div>
            <div><span>Confidence</span><strong>{Math.round(analysis.confidence * 100)}%</strong></div>
          </section>

          {analysis.warnings.map((warning) => (
            <div className="sms-review-warning" key={warning}><WarningCircle size={18} /><span>{warning}</span></div>
          ))}
          {similarTransfer && <div className="sms-review-warning"><WarningCircle size={18} /><span><strong>Already recorded?</strong> A transfer of this amount from {routeLabel(similarTransfer.fromAccountId)} to {routeLabel(similarTransfer.toAccountId)} is saved for {formatLedgerDate(similarTransfer.occurredOn, calendarSystem)}. Your bank and wallet often both send an alert for one load; save this only if you moved the money twice.</span></div>}
          {!asTransfer && duplicateWarnings.map((warning) => (
            <div className={`sms-review-warning ${warning.tone}`} key={warning.type + warning.title}>
              <WarningCircle size={18} /><span><strong>{warning.title}.</strong> {warning.detail}</span>
            </div>
          ))}
          {analysis.transfer && onSaveTransfer && <div className="sms-transfer-note">
            <ArrowsLeftRight size={18} aria-hidden /><span>{analysis.transfer.message}{!asTransfer && (analysis.transfer.ready || ownAccounts.length > 1) && <> <button type="button" className="text-button" onClick={() => changeReviewType("transfer")}>Record as a transfer</button></>}{analysis.transfer.reason === "atm" && !ownAccounts.some(isCashAccount) && <> <Link href="/accounts#add-account" onClick={close}>Add Cash in hand</Link></>}</span>
          </div>}
          {!asTransfer && personalizedNote && <p className="sms-personalized-note">{personalizedNote}</p>}

          <div className="sms-review-grid">
            <Select label="Type" value={reviewType} allowDeselect={false} data={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, ...(onSaveTransfer ? [{ value: "transfer", label: "Transfer between my accounts" }] : [])]}
              onChange={(value) => value && changeReviewType(value as ReviewType)} />
            <NumberInput label={`Amount in ${currency}`} value={draft.amount} min={0} decimalScale={2} thousandSeparator=","
              onChange={(value) => update({ amount: String(value) })} />
          </div>

          <DatePickerInput label="Date" description={calendarSystem === "BS" && draft.occurredOn ? formatLedgerDate(draft.occurredOn, "BS") : undefined} value={draft.occurredOn} onChange={(value) => value && update({ occurredOn: value })} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
          <TextInput label={asTransfer ? "Note" : "Description"} value={draft.note} maxLength={80} onChange={(event) => update({ note: event.currentTarget.value })} />

          {asTransfer ? <>
            <div className="sms-review-grid">
              <Select label="From" placeholder={ownAccounts.length > 1 ? "Choose the source" : "Add an account first"} value={route.fromAccountId || null} allowDeselect={false} disabled={ownAccounts.length < 2}
                data={transferOptions} onChange={(value) => setRoute((current) => ({ ...current, fromAccountId: value ?? "" }))} />
              <Select label="To" placeholder={ownAccounts.length > 1 ? "Choose the destination" : "Add an account first"} value={route.toAccountId || null} allowDeselect={false} disabled={ownAccounts.length < 2}
                data={transferOptions.map((option) => ({ ...option, disabled: option.value === route.fromAccountId }))} onChange={(value) => setRoute((current) => ({ ...current, toAccountId: value ?? "" }))} />
            </div>
            <p className="sms-personalized-note">A transfer moves money between your own accounts. It is not counted as income or spending.</p>
          </> : <>
          <div className="sms-review-grid">
            <Select label="Category" value={draft.category} allowDeselect={false} data={categories.map((category) => ({ value: category.id, label: category.label }))}
              onChange={(value) => value && update({ category: value, subcategory: "" })} />
            {subcategories.length > 0 && <Select label="Subcategory" value={draft.subcategory || null} placeholder="Optional" clearable
              data={subcategories.map((item) => item.name)} onChange={(value) => update({ subcategory: value ?? "" })} />}
          </div>

          <div className="sms-review-grid">
            <Select label="Payment method" value={draft.paymentMode} allowDeselect={false}
              data={[{ value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "online", label: "Online payment" }]}
              onChange={(value) => update({ paymentMode: value as PaymentMode, paymentAccountId: value === "online" ? draft.paymentAccountId : "" })} />
            {draft.paymentMode === "online" && <Select label="Payment account" placeholder={onlineAccounts.length ? "Choose an account" : "Add an account first"}
              value={draft.paymentAccountId || null} allowDeselect={false} disabled={!onlineAccounts.length}
              data={onlineAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))}
              onChange={(value) => update({ paymentAccountId: value ?? "" })} />}
          </div>
          </>}

          {!amountIsValid && <p className="receipt-total-error">Enter an amount greater than zero.</p>}
          {accountIsMissing && <p className="receipt-total-error">Choose the payment account used for this transaction.</p>}
          {routeIsMissing && <p className="receipt-total-error">{ownAccounts.length < 2 ? "Add at least two of your own accounts on the Accounts page to record a transfer." : "Choose two different accounts."}</p>}
          <FormError message={error} />

          <p className="sms-review-footnote">Nothing has been saved yet.</p>
          <div className="dialog-actions">
            <button className="secondary-button" disabled={stage === "saving"} onClick={() => { setStage("ready"); setDraft(null); setAnalysis(null); }}>Back</button>
            <button className="primary-button" disabled={!canSave} onClick={() => void save()}>
              {stage === "saving" ? <><ButtonSpinner />Saving…</> : asTransfer ? <><ArrowsLeftRight size={17} />Save transfer</> : <><Sparkle size={17} />Save transaction</>}
            </button>
          </div>
        </div>}
      </section>
    </AnimatedOverlay>
  </>;
}
