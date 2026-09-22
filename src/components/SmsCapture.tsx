"use client";

import { NumberInput, Select, Textarea, TextInput } from "@mantine/core";
import { ChatText, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { allCategoriesFor, subcategoryOptionsFor } from "../lib/categories";
import { majorToMinor } from "../lib/currency";
import { todayInput } from "../lib/dates";
import { matchLearningSuggestion } from "../lib/learning";
import { paymentAccountLabel } from "../lib/payment-accounts";
import { smsResultToDraft, type SmsAnalysis } from "../lib/sms-analysis";
import { parseBankSms, SMS_MAX_LENGTH } from "../lib/sms-templates";
import { transactionWarnings } from "../lib/transaction-intelligence";
import type {
  CurrencyCode, CustomCategory, CustomSubcategory, LearningState, LedgerTransaction,
  PaymentAccount, PaymentMode, TransactionDraft,
} from "../types";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { ButtonSpinner } from "./ButtonSpinner";
import { LedgerDatePickerInput as DatePickerInput } from "./LedgerDatePickerInput";

interface SmsCaptureProps {
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  customSubcategories: CustomSubcategory[];
  paymentAccounts: PaymentAccount[];
  learning: LearningState;
  onSave: (draft: TransactionDraft) => Promise<string | undefined>;
}

type Stage = "ready" | "parsing" | "reviewing" | "saving";

export function SmsCapture({ currency, transactions, customCategories, customSubcategories, paymentAccounts, learning, onSave }: SmsCaptureProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("ready");
  const [message, setMessage] = useState("");
  const [analysis, setAnalysis] = useState<SmsAnalysis | null>(null);
  const [draft, setDraft] = useState<TransactionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personalizedFrom, setPersonalizedFrom] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);

  const categories = useMemo(
    () => allCategoriesFor(draft?.kind ?? "expense", customCategories),
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
    setPersonalizedFrom(null);
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

  /** Fills the fields the message itself cannot state, from the learning profile. */
  const withPersonalization = (result: SmsAnalysis): SmsAnalysis => {
    const place = result.draft.area || result.draft.note;
    const suggestion = place ? matchLearningSuggestion(learning, place, result.draft.kind) : null;
    if (!suggestion) return result;
    setPersonalizedFrom(suggestion.place);
    return {
      ...result,
      draft: {
        ...result.draft,
        category: suggestion.category,
        subcategory: suggestion.subcategory,
        paymentMode: suggestion.paymentMode,
        paymentAccountId: suggestion.paymentMode === "online" ? result.draft.paymentAccountId : "",
      },
    };
  };

  const read = async () => {
    const text = message.trim();
    if (!text) return;
    const operation = ++operationRef.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setPersonalizedFrom(null);
    setStage("parsing");

    // The offline parser handles the common formats instantly and without
    // sending the message anywhere. Gemini is only asked about messages it
    // cannot read.
    const offline = parseBankSms(text, todayInput());
    if (offline) {
      const result = withPersonalization(smsResultToDraft(offline, todayInput(), paymentAccounts));
      setAnalysis(result);
      setDraft(result.draft);
      setStage("reviewing");
      requestRef.current = null;
      return;
    }

    try {
      const response = await fetch("/api/imports/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const body = await response.json() as { analysis?: SmsAnalysis; error?: string };
      if (operation !== operationRef.current) return;
      if (!response.ok || !body.analysis) throw new Error(body.error ?? "Could not read this message.");
      const result = withPersonalization(body.analysis);
      setAnalysis(result);
      setDraft(result.draft);
      setStage("reviewing");
    } catch (caught) {
      const cancelled = caught instanceof Error && caught.name === "AbortError";
      if (!cancelled && operation === operationRef.current) {
        setError(caught instanceof Error ? caught.message : "Could not read this message.");
        setStage("ready");
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const update = (changes: Partial<TransactionDraft>) => {
    setDraft((current) => current ? { ...current, ...changes } : current);
  };

  const amountIsValid = Boolean(draft && Number(draft.amount.replace(/,/g, "")) > 0);
  const accountIsMissing = draft?.paymentMode === "online" && !draft.paymentAccountId;
  const canSave = Boolean(draft && amountIsValid && !accountIsMissing && stage === "reviewing");

  const save = async () => {
    if (!canSave || !draft) return;
    setStage("saving");
    setError(null);
    try {
      await onSave(draft);
      setOpen(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this transaction.");
      setStage("reviewing");
    }
  };

  const subcategories = draft ? subcategoryOptionsFor(draft.category, customSubcategories) : [];

  return <>
    <button className="secondary-button sms-capture-trigger" onClick={() => setOpen(true)}>
      <ChatText size={18} />Paste bank SMS
    </button>
    <AnimatedOverlay open={open} dismissOnBackdrop onClose={close}>
      <section className="sms-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="sms-capture-title" aria-busy={stage === "parsing" || stage === "saving"}>
        <header>
          <div>
            <span className="eyebrow">Quick capture</span>
            <h2 id="sms-capture-title">{stage === "reviewing" || stage === "saving" ? "Review before saving" : "Paste a bank message"}</h2>
          </div>
          <button className="icon-button" disabled={stage === "saving"} onClick={close} aria-label="Close"><X size={20} /></button>
        </header>

        {stage !== "reviewing" && stage !== "saving" ? <div className="sms-capture-step">
          <p>Paste the confirmation SMS from your bank or wallet. Most messages are read on your device without leaving it; only an unrecognised format is sent to Gemini.</p>
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
          {error && <p className="form-error">{error}</p>}
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
          {duplicateWarnings.map((warning) => (
            <div className={`sms-review-warning ${warning.tone}`} key={warning.type + warning.title}>
              <WarningCircle size={18} /><span><strong>{warning.title}.</strong> {warning.detail}</span>
            </div>
          ))}
          {personalizedFrom && <p className="sms-personalized-note">Category and payment method filled from what you usually record at {personalizedFrom}.</p>}

          <div className="sms-review-grid">
            <Select label="Type" value={draft.kind} allowDeselect={false} data={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }]}
              onChange={(value) => value && update({ kind: value as TransactionDraft["kind"], category: value === "income" ? "salary" : "other", subcategory: "" })} />
            <NumberInput label={`Amount in ${currency}`} value={draft.amount} min={0} decimalScale={2} thousandSeparator=","
              onChange={(value) => update({ amount: String(value) })} />
          </div>

          <DatePickerInput label="Date" value={draft.occurredOn} onChange={(value) => value && update({ occurredOn: value })} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
          <TextInput label="Description" value={draft.note} maxLength={80} onChange={(event) => update({ note: event.currentTarget.value })} />

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
            {draft.paymentMode === "online" && <Select label="Payment account" placeholder={paymentAccounts.length ? "Choose an account" : "Add an account first"}
              value={draft.paymentAccountId || null} allowDeselect={false} disabled={!paymentAccounts.length}
              data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))}
              onChange={(value) => update({ paymentAccountId: value ?? "" })} />}
          </div>

          {!amountIsValid && <p className="receipt-total-error">Enter an amount greater than zero.</p>}
          {accountIsMissing && <p className="receipt-total-error">Choose the payment account used for this transaction.</p>}
          {error && <p className="form-error">{error}</p>}

          <p className="sms-review-footnote">Nothing has been saved yet.</p>
          <div className="dialog-actions">
            <button className="secondary-button" disabled={stage === "saving"} onClick={() => { setStage("ready"); setDraft(null); setAnalysis(null); }}>Back</button>
            <button className="primary-button" disabled={!canSave} onClick={() => void save()}>
              {stage === "saving" ? <><ButtonSpinner />Saving…</> : <><Sparkle size={17} />Save transaction</>}
            </button>
          </div>
        </div>}
      </section>
    </AnimatedOverlay>
  </>;
}
