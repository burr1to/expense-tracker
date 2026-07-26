"use client";

import { NumberInput, Select, TextInput } from "@mantine/core";
import { Camera, Plus, Sparkle, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { allCategoriesFor, getCategory, subcategoriesFor } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { discardReceipt, prepareReceiptPhoto, uploadReceipt } from "../lib/receipts";
import { analysisToDrafts, draftTotalMinor, type ReceiptAnalysis } from "../lib/receipt-analysis";
import type { CurrencyCode, CustomCategory, PaymentAccount, PaymentMode, ReceiptUpload, TransactionDraft } from "../types";
import { ButtonSpinner } from "./ButtonSpinner";
import { LedgerDatePickerInput as DatePickerInput } from "./LedgerDatePickerInput";
import { paymentAccountLabel } from "../lib/payment-accounts";

interface ReceiptScannerProps {
  currency: CurrencyCode;
  fallbackOccurredOn: string;
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  onSave: (drafts: TransactionDraft[], receipt: ReceiptUpload, totalMinor: number) => Promise<number>;
}

type Stage = "ready" | "uploading" | "analyzing" | "reviewing" | "saving";

export function ReceiptScanner({ currency, fallbackOccurredOn, customCategories, paymentAccounts, onSave }: ReceiptScannerProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("ready");
  const [receipt, setReceipt] = useState<ReceiptUpload | null>(null);
  const [analysis, setAnalysis] = useState<ReceiptAnalysis | null>(null);
  const [drafts, setDrafts] = useState<TransactionDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const receiptRef = useRef<ReceiptUpload | null>(null);
  const categories = useMemo(() => allCategoriesFor("expense", customCategories), [customCategories]);
  const splitTotal = draftTotalMinor(drafts);
  const currencyMismatch = Boolean(analysis && analysis.currency !== "UNKNOWN" && analysis.currency !== currency);
  const everySplitIsPositive = drafts.every((draft) => {
    const amount = Number(draft.amount.replace(/,/g, ""));
    return Number.isFinite(amount) && amount > 0;
  });
  const canSave = Boolean(receipt && analysis && drafts.length && everySplitIsPositive && splitTotal === analysis.totalMinor && !currencyMismatch && stage === "reviewing");

  useEffect(() => () => {
    operationRef.current += 1;
    requestRef.current?.abort();
    const pending = receiptRef.current;
    receiptRef.current = null;
    if (pending) void discardReceipt(pending).catch(() => undefined);
  }, []);

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setReceipt(null);
    receiptRef.current = null;
    setAnalysis(null);
    setDrafts([]);
    setError(null);
    setStage("ready");
  };

  const close = async () => {
    if (stage === "saving") return;
    operationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    const pending = receiptRef.current;
    receiptRef.current = null;
    setOpen(false);
    reset();
    if (pending) await discardReceipt(pending).catch(() => undefined);
  };

  const analyze = async (uploaded: ReceiptUpload, signal: AbortSignal) => {
    const response = await fetch("/api/receipts/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt: uploaded, fallbackOccurredOn }),
      signal,
    });
    const body = await response.json() as { analysis?: ReceiptAnalysis; error?: string };
    if (!response.ok || !body.analysis) throw new Error(body.error ?? "Could not analyze this receipt.");
    return body.analysis;
  };

  const chooseFile = async (file: File) => {
    const operation = ++operationRef.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setStage("uploading");
    let uploaded: ReceiptUpload | null = null;
    try {
      const prepared = await prepareReceiptPhoto(file);
      if (operation !== operationRef.current) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(prepared));
      uploaded = await uploadReceipt(prepared, controller.signal);
      if (operation !== operationRef.current) {
        await discardReceipt(uploaded).catch(() => undefined);
        return;
      }
      setReceipt(uploaded);
      receiptRef.current = uploaded;
      setStage("analyzing");
      const result = await analyze(uploaded, controller.signal);
      if (operation !== operationRef.current) return;
      setAnalysis(result);
      setDrafts(analysisToDrafts(result));
      setStage("reviewing");
    } catch (caught) {
      const cancelled = caught instanceof Error && caught.name === "AbortError";
      if (!cancelled && operation === operationRef.current) {
        setError(caught instanceof Error ? caught.message : "Could not scan this receipt.");
        setStage("ready");
      }
      if (uploaded) {
        await discardReceipt(uploaded).catch(() => undefined);
        if (receiptRef.current?.storagePath === uploaded.storagePath) {
          receiptRef.current = null;
          setReceipt(null);
        }
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const updateDraft = (index: number, changes: Partial<TransactionDraft>) => {
    setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...changes } : draft));
  };

  const updateAll = (changes: Partial<TransactionDraft>) => {
    setDrafts((current) => current.map((draft) => ({ ...draft, ...changes })));
  };

  const addSplit = () => {
    setDrafts((current) => [...current, {
      kind: "expense",
      category: "other",
      amount: "",
      occurredOn: current[0]?.occurredOn ?? fallbackOccurredOn,
      note: analysis?.merchant ? `${analysis.merchant} · Other`.slice(0, 80) : "Receipt split",
      subcategory: "",
      area: "",
      paymentMode: current[0]?.paymentMode ?? "cash",
      paymentAccountId: current[0]?.paymentAccountId ?? "",
    }]);
  };

  const save = async () => {
    if (!canSave || !receipt || !analysis) return;
    setStage("saving");
    setError(null);
    try {
      await onSave(drafts, receipt, analysis.totalMinor);
      receiptRef.current = null;
      setReceipt(null);
      setOpen(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save these transactions.");
      setStage("reviewing");
    }
  };

  return <>
    <button className="secondary-button receipt-scan-trigger" onClick={() => setOpen(true)}><Camera size={18} />Scan receipt <span>AI</span></button>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && void close()}>
      <section className="receipt-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-scan-title" aria-busy={stage === "uploading" || stage === "analyzing" || stage === "saving"}>
        <header>
          <div><span className="eyebrow">Experimental AI</span><h2 id="receipt-scan-title">{stage === "reviewing" || stage === "saving" ? "Review receipt splits" : "Scan a receipt"}</h2></div>
          <button className="icon-button" disabled={stage === "saving"} onClick={() => void close()} aria-label={stage === "uploading" || stage === "analyzing" ? "Cancel receipt scan" : "Close"}><X size={20} /></button>
        </header>

        {stage !== "reviewing" && stage !== "saving" ? <div className="receipt-capture-step">
          <div className="receipt-camera-mark"><Camera size={34} weight="duotone" /></div>
          <div><strong>Photograph a clear, flat receipt</strong><p>Gemini will suggest the merchant, date, total and category splits. Nothing enters your ledger until you review and confirm it.</p></div>
          <div className="receipt-privacy-note"><WarningCircle size={18} /><span><strong>Use test receipts for now.</strong> Free-tier Gemini sends the image to Google and may use it to improve its products.</span></div>
          {previewUrl && <img className="receipt-capture-preview" src={previewUrl} alt="Receipt selected for analysis" />}
          {error && <p className="form-error">{error}</p>}
          <input ref={fileRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void chooseFile(file);
          }} />
          <button className="primary-button full-width" disabled={stage !== "ready"} onClick={() => fileRef.current?.click()}>
            {stage === "uploading" ? <><ButtonSpinner />Uploading…</> : stage === "analyzing" ? <><ButtonSpinner />Gemini is reading…</> : <><Camera size={18} />Open camera</>}
          </button>
        </div> : analysis && <div className="receipt-review-step">
          <section className="receipt-analysis-summary">
            <div><span>Merchant</span><strong>{analysis.merchant || "Not detected"}</strong></div>
            <div><span>Receipt total</span><strong>{formatMoney(analysis.totalMinor, currency)}</strong></div>
            <div><span>Split total</span><strong className={splitTotal === analysis.totalMinor ? "matches" : "mismatch"}>{formatMoney(splitTotal, currency)}</strong></div>
          </section>

          {currencyMismatch && <div className="receipt-review-warning"><WarningCircle size={18} /><span>This receipt appears to use {analysis.currency}, but your ledger uses {currency}. Automatic saving is blocked to avoid a false conversion.</span></div>}
          {analysis.warnings.length > 0 && <div className="receipt-review-warning"><WarningCircle size={18} /><span>{analysis.warnings.join(" ")}</span></div>}

          <section className="receipt-common-fields">
            <DatePickerInput label="Date for every split" value={drafts[0]?.occurredOn ?? fallbackOccurredOn} onChange={(value) => value && updateAll({ occurredOn: value })} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
            <Select label="Payment method" value={drafts[0]?.paymentMode ?? "cash"} data={[{ value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "online", label: "Online payment" }]} allowDeselect={false} onChange={(value) => updateAll({ paymentMode: value as PaymentMode, paymentAccountId: value === "online" ? drafts[0]?.paymentAccountId ?? "" : "" })} />
            {drafts[0]?.paymentMode === "online" && <Select label="Payment account" placeholder={paymentAccounts.length ? "Choose an account" : "Add an account first"} value={drafts[0]?.paymentAccountId || null} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} allowDeselect={false} disabled={!paymentAccounts.length} onChange={(value) => updateAll({ paymentAccountId: value ?? "" })} />}
          </section>

          <div className="receipt-split-list">
            {drafts.map((draft, index) => {
              const subcategories = subcategoriesFor(draft.category).options;
              return <article className="receipt-split-card" key={index}>
                <div className="receipt-split-heading"><span>Split {index + 1}</span><button className="icon-button danger-text" disabled={drafts.length === 1 || stage === "saving"} onClick={() => setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))} aria-label={`Remove split ${index + 1}`}><Trash size={17} /></button></div>
                <TextInput label="Description" value={draft.note} maxLength={80} onChange={(event) => updateDraft(index, { note: event.currentTarget.value })} />
                <div className="receipt-split-grid">
                  <NumberInput label={`Amount in ${currency}`} value={draft.amount} min={0} decimalScale={2} thousandSeparator="," onChange={(value) => updateDraft(index, { amount: String(value) })} />
                  <Select label="Category" value={draft.category} data={categories.map((category) => ({ value: category.id, label: category.label }))} allowDeselect={false} onChange={(value) => value && updateDraft(index, { category: value, subcategory: "" })} />
                </div>
                {subcategories.length > 0 && <Select label="Subcategory" value={draft.subcategory || null} placeholder="Optional" data={[...subcategories]} clearable onChange={(value) => updateDraft(index, { subcategory: value ?? "" })} />}
                <small>{getCategory(draft.category, customCategories).label} · AI confidence {Math.round((analysis.splits[index]?.confidence ?? analysis.confidence) * 100)}%</small>
              </article>;
            })}
          </div>

          <button className="secondary-button add-receipt-split" disabled={drafts.length >= 20 || stage === "saving"} onClick={addSplit}><Plus size={17} />Add another split</button>
          {splitTotal !== analysis.totalMinor && <p className="receipt-total-error">Adjust the splits by {formatMoney(Math.abs(analysis.totalMinor - splitTotal), currency)} so they exactly match the receipt total.</p>}
          {drafts[0]?.paymentMode === "online" && !drafts[0]?.paymentAccountId && <p className="receipt-total-error">Choose the payment account used for this receipt.</p>}
          {error && <p className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button className="secondary-button" disabled={stage === "saving"} onClick={() => void close()}>Cancel</button>
            <button className="primary-button" disabled={!canSave || (drafts[0]?.paymentMode === "online" && !drafts[0]?.paymentAccountId)} onClick={() => void save()}>{stage === "saving" ? <><ButtonSpinner />Adding…</> : <><Sparkle size={17} />Add {drafts.length} {drafts.length === 1 ? "transaction" : "transactions"}</>}</button>
          </div>
        </div>}
      </section>
    </div>}
  </>;
}
