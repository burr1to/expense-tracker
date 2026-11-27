"use client";

import { NumberInput, Select, TextInput } from "@mantine/core";
import { Camera, Plus, Sparkle, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { aiCategoryChoices, getCategory, spendingCategoriesFor, subcategoryOptionsFor } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { discardReceipt, prepareReceiptPhoto, uploadReceipt } from "../lib/receipts";
import { analysisToDrafts, draftTotalMinor, type ReceiptAnalysis } from "../lib/receipt-analysis";
import { readReceiptText, releaseReceiptReader, warmReceiptReader } from "../lib/receipt-ocr";
import { chooseReceiptRoute, cleanReceiptText, localReceiptAnalysis, parseReceiptText } from "../lib/receipt-text";
import { todayInAppZone } from "../lib/period";
import type { CurrencyCode, CustomCategory, CustomSubcategory, PaymentAccount, PaymentMode, ReceiptUpload, TransactionDraft } from "../types";
import { ButtonSpinner } from "./ButtonSpinner";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { LedgerDatePickerInput as DatePickerInput } from "./LedgerDatePickerInput";
import { paymentAccountLabel } from "../lib/payment-accounts";
import { FormError } from "./FormError";
import { readResponse, responseMessage, toUserMessage } from "../lib/user-messages";

interface ReceiptScannerProps {
  currency: CurrencyCode;
  fallbackOccurredOn: string;
  customCategories: CustomCategory[];
  customSubcategories: CustomSubcategory[];
  paymentAccounts: PaymentAccount[];
  onSave: (drafts: TransactionDraft[], receipt: ReceiptUpload, totalMinor: number) => Promise<number>;
  /** Controlled mode: the workspace opens this sheet from anywhere. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render the "Scan receipt" trigger button. Defaults to true. */
  showTrigger?: boolean;
  /** A photo shared in from another app: read as soon as the sheet is open, as if just taken. */
  sharedFile?: File | null;
  onSharedFileTaken?: () => void;
}

type Stage = "ready" | "uploading" | "reading" | "analyzing" | "confirm-photo" | "reviewing" | "saving";
/** Who produced the review: this phone's reader, Gemini from the text alone, or Gemini from the photo. */
type ReadSource = "device" | "text" | "photo";

class AnalyzeError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function ReceiptScanner({ currency, fallbackOccurredOn, customCategories, customSubcategories, paymentAccounts, onSave, open: openProp, onOpenChange, showTrigger = true, sharedFile, onSharedFileTaken }: ReceiptScannerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [stage, setStage] = useState<Stage>("ready");
  const [receipt, setReceipt] = useState<ReceiptUpload | null>(null);
  const [analysis, setAnalysis] = useState<ReceiptAnalysis | null>(null);
  const [drafts, setDrafts] = useState<TransactionDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [source, setSource] = useState<ReadSource>("device");
  const [readText, setReadText] = useState<string | null>(null);
  const [photoReason, setPhotoReason] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const receiptRef = useRef<ReceiptUpload | null>(null);
  // A receipt is spending: its splits never go to the loan category.
  const categories = useMemo(() => spendingCategoriesFor("expense", customCategories), [customCategories]);
  const categoryChoices = useMemo(() => aiCategoryChoices(customCategories, customSubcategories, "expense"), [customCategories, customSubcategories]);
  const splitTotal = draftTotalMinor(drafts);
  const currencyMismatch = Boolean(analysis && analysis.currency !== "UNKNOWN" && analysis.currency !== currency);
  const everySplitIsPositive = drafts.every((draft) => {
    const amount = Number(draft.amount.replace(/,/g, ""));
    return Number.isFinite(amount) && amount > 0;
  });
  const canSave = Boolean(receipt && analysis && drafts.length && everySplitIsPositive && splitTotal === analysis.totalMinor && !currencyMismatch && stage === "reviewing" && !checking);

  // Load the on-phone reader while the user lines up the photo; free it on close.
  useEffect(() => {
    if (!open) return;
    void warmReceiptReader().catch(() => undefined);
    return () => { void releaseReceiptReader(); };
  }, [open]);

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
    setReadText(null);
    setPhotoReason(null);
    setChecking(false);
    setStage("ready");
  };

  const show = (result: ReceiptAnalysis, from: ReadSource) => {
    setAnalysis(result);
    setDrafts(analysisToDrafts(result));
    setSource(from);
    setPhotoReason(null);
    setStage("reviewing");
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

  /** With text, Gemini sees only the words read on this phone; without it, the photo. */
  const analyze = async (uploaded: ReceiptUpload, signal: AbortSignal, text?: string) => {
    const response = await fetch("/api/receipts/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt: uploaded, fallbackOccurredOn, ...(text ? { text } : {}) }),
      signal,
    });
    const parsed = await readResponse<{ analysis?: ReceiptAnalysis; error?: string }>(response);
    if (!response.ok || !parsed.body?.analysis) throw new AnalyzeError(responseMessage(parsed, "Could not analyze this receipt."), response.status);
    return parsed.body.analysis;
  };

  /** Quota or setup problems: the photo would fail the same way, so don't offer it. */
  const geminiUnavailable = (caught: unknown) => caught instanceof AnalyzeError && (caught.status === 429 || caught.status === 503);

  const chooseFile = async (file: File) => {
    const operation = ++operationRef.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setPhotoReason(null);
    setReadText(null);
    // A retaken photo replaces the one waiting for a decision.
    const replaced = receiptRef.current;
    receiptRef.current = null;
    setReceipt(null);
    if (replaced) void discardReceipt(replaced).catch(() => undefined);
    setStage("uploading");
    let uploaded: ReceiptUpload | null = null;
    try {
      const prepared = await prepareReceiptPhoto(file);
      if (operation !== operationRef.current) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(prepared));
      // The photo is saved to the user's own receipt storage while this phone reads it.
      const reading = readReceiptText(prepared).catch(() => null);
      uploaded = await uploadReceipt(prepared, controller.signal);
      if (operation !== operationRef.current) {
        await discardReceipt(uploaded).catch(() => undefined);
        return;
      }
      setReceipt(uploaded);
      receiptRef.current = uploaded;
      setStage("reading");
      const read = await reading;
      if (operation !== operationRef.current) return;
      const text = read ? cleanReceiptText(read.text) : "";
      const parsed = read ? parseReceiptText(text, { today: todayInAppZone(), categories: categoryChoices }) : null;
      const route = read && parsed ? chooseReceiptRoute(parsed, { text, ocrConfidence: read.ocrConfidence }) : "photo";
      const local = parsed?.totalMinor ? localReceiptAnalysis(parsed, { fallbackOccurredOn, categories: categoryChoices }) : null;
      setReadText(text.length >= 20 ? text : null);

      if (route === "device" && local) return show(local, "device");
      if (route === "text") {
        setStage("analyzing");
        setSource("text");
        try {
          const result = await analyze(uploaded, controller.signal, text);
          if (operation !== operationRef.current) return;
          return show(result, "text");
        } catch (caught) {
          if (caught instanceof Error && caught.name === "AbortError") throw caught;
          if (operation !== operationRef.current) return;
          // Gemini couldn't help, but this phone found a total: let the user check it.
          if (local) return show({ ...local, warnings: [`Gemini couldn’t check this receipt (${toUserMessage(caught, null, "it was unavailable")}), so only this phone’s reading is shown.`, ...local.warnings] }, "device");
          if (geminiUnavailable(caught)) throw caught;
        }
      }
      setPhotoReason(read ? "This phone couldn’t read the receipt clearly." : "The reader on this phone couldn’t start.");
      setStage("confirm-photo");
    } catch (caught) {
      const cancelled = caught instanceof Error && caught.name === "AbortError";
      if (!cancelled && operation === operationRef.current) {
        setError(toUserMessage(caught, null, "Could not scan this receipt."));
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

  // A photo shared in from another app goes straight to the reader, once per share.
  const takenSharedFile = useRef<File | null>(null);
  useEffect(() => {
    if (!open || !sharedFile || takenSharedFile.current === sharedFile) return;
    takenSharedFile.current = sharedFile;
    onSharedFileTaken?.();
    void chooseFile(sharedFile);
    // chooseFile and onSharedFileTaken are new each render; only a new share should start a read.
  }, [open, sharedFile]);

  /** Only after the user agrees: Gemini reads the photo itself. */
  const sendPhoto = async () => {
    const uploaded = receiptRef.current;
    if (!uploaded) return;
    const operation = ++operationRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setSource("photo");
    setStage("analyzing");
    try {
      const result = await analyze(uploaded, controller.signal);
      if (operation === operationRef.current) show(result, "photo");
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      if (operation !== operationRef.current) return;
      setError(toUserMessage(caught, null, "Gemini could not read this photo."));
      setStage("confirm-photo");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  /** From a phone-only review: let Gemini split and categorise the same text. */
  const checkWithGemini = async () => {
    const uploaded = receiptRef.current;
    if (!uploaded || !readText) return;
    const operation = operationRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setChecking(true);
    try {
      const result = await analyze(uploaded, controller.signal, readText);
      if (operation === operationRef.current) show(result, "text");
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      if (operation === operationRef.current) setError(toUserMessage(caught, null, "Gemini could not check this receipt."));
    } finally {
      setChecking(false);
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
    {showTrigger && <button className="secondary-button receipt-scan-trigger" onClick={() => setOpen(true)}><Camera size={18} />Scan receipt <span>AI</span></button>}
    <AnimatedOverlay open={open} dismissOnBackdrop onClose={() => void close()}>
      <section className="receipt-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-scan-title" aria-busy={stage === "uploading" || stage === "reading" || stage === "analyzing" || stage === "saving" || checking}>
        <header>
          <div><span className="eyebrow">Receipt reader</span><h2 id="receipt-scan-title">{stage === "reviewing" || stage === "saving" ? "Review receipt splits" : "Scan a receipt"}</h2></div>
          <button className="icon-button" disabled={stage === "saving"} onClick={() => void close()} aria-label={stage === "uploading" || stage === "reading" || stage === "analyzing" ? "Cancel receipt scan" : "Close"}><X size={20} /></button>
        </header>

        {stage !== "reviewing" && stage !== "saving" ? <div className="receipt-capture-step">
          <div className="receipt-camera-mark"><Camera size={34} weight="duotone" /></div>
          <div><strong>Photograph a clear, flat receipt</strong><p>This phone reads the shop, date and total first. Gemini helps only when it can’t, and nothing enters your ledger until you review and confirm it.</p></div>
          {stage === "confirm-photo"
            ? <div className="receipt-review-warning" role="status"><WarningCircle size={18} /><span><strong>{photoReason}</strong> Send the photo to Gemini to read it, or retake it closer, flat and well lit. Free-tier Gemini may use the photo to improve Google’s products.</span></div>
            : <div className="receipt-privacy-note"><WarningCircle size={18} /><span><strong>Reading happens on this phone.</strong> If it isn’t sure, only the receipt’s text goes to Gemini. The photo goes only if you choose. Free-tier Gemini may use what it receives to improve Google’s products.</span></div>}
          {previewUrl && <img className="receipt-capture-preview" src={previewUrl} alt="Receipt selected for analysis" />}
          <FormError message={error} />
          <input ref={fileRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void chooseFile(file);
          }} />
          {stage === "confirm-photo" ? <div className="dialog-actions">
            <button className="secondary-button" onClick={() => fileRef.current?.click()}><Camera size={17} />Retake photo</button>
            <button className="primary-button" onClick={() => void sendPhoto()}><Sparkle size={17} />Send photo to Gemini</button>
          </div> : <button className="primary-button full-width" disabled={stage !== "ready"} onClick={() => fileRef.current?.click()}>
            {stage === "uploading" ? <><ButtonSpinner />Uploading…</>
              : stage === "reading" ? <><ButtonSpinner />Reading on this phone…</>
              : stage === "analyzing" ? <><ButtonSpinner />{source === "photo" ? "Gemini is reading the photo…" : "Gemini is checking the text…"}</>
              : <><Camera size={18} />Open camera</>}
          </button>}
        </div> : analysis && <div className="receipt-review-step">
          <section className="receipt-analysis-summary">
            <div><span>Merchant</span><strong>{analysis.merchant || "Not detected"}</strong></div>
            <div><span>Receipt total</span><strong>{formatMoney(analysis.totalMinor, currency)}</strong></div>
            <div><span>Split total</span><strong className={splitTotal === analysis.totalMinor ? "matches" : "mismatch"}>{formatMoney(splitTotal, currency)}</strong></div>
          </section>

          <p className="receipt-read-source">
            {source === "device" ? "Read on this phone. No AI was used." : source === "text" ? "Gemini read the text only. The photo stayed private." : "Gemini read the photo."}
            {source === "device" && readText && <button className="text-button" disabled={checking || stage === "saving"} onClick={() => void checkWithGemini()}>{checking ? <><ButtonSpinner />Checking…</> : "Let Gemini split it"}</button>}
          </p>

          {currencyMismatch && <div className="receipt-review-warning"><WarningCircle size={18} /><span>This receipt appears to use {analysis.currency}, but your ledger uses {currency}. Automatic saving is blocked to avoid a false conversion.</span></div>}
          {analysis.warnings.length > 0 && <div className="receipt-review-warning"><WarningCircle size={18} /><span>{analysis.warnings.join(" ")}</span></div>}

          <section className="receipt-common-fields">
            <DatePickerInput label="Date for every split" value={drafts[0]?.occurredOn ?? fallbackOccurredOn} onChange={(value) => value && updateAll({ occurredOn: value })} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
            <Select label="Payment method" value={drafts[0]?.paymentMode ?? "cash"} data={[{ value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "online", label: "Online payment" }]} allowDeselect={false} onChange={(value) => updateAll({ paymentMode: value as PaymentMode, paymentAccountId: value === "online" ? drafts[0]?.paymentAccountId ?? "" : "" })} />
            {drafts[0]?.paymentMode === "online" && <Select label="Payment account" placeholder={paymentAccounts.length ? "Choose an account" : "Add an account first"} value={drafts[0]?.paymentAccountId || null} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} allowDeselect={false} disabled={!paymentAccounts.length} onChange={(value) => updateAll({ paymentAccountId: value ?? "" })} />}
          </section>

          <div className="receipt-split-list">
            {drafts.map((draft, index) => {
              const subcategories = subcategoryOptionsFor(draft.category, customSubcategories);
              return <article className="receipt-split-card" key={index}>
                <div className="receipt-split-heading"><span>Split {index + 1}</span><button className="icon-button danger-text" disabled={drafts.length === 1 || stage === "saving"} onClick={() => setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))} aria-label={`Remove split ${index + 1}`}><Trash size={17} /></button></div>
                <TextInput label="Description" value={draft.note} maxLength={80} onChange={(event) => updateDraft(index, { note: event.currentTarget.value })} />
                <div className="receipt-split-grid">
                  <NumberInput label={`Amount in ${currency}`} value={draft.amount} min={0} decimalScale={2} thousandSeparator="," onChange={(value) => updateDraft(index, { amount: String(value) })} />
                  <Select label="Category" value={draft.category} data={categories.map((category) => ({ value: category.id, label: category.label }))} allowDeselect={false} onChange={(value) => value && updateDraft(index, { category: value, subcategory: "" })} />
                </div>
                {subcategories.length > 0 && <Select label="Subcategory" value={draft.subcategory || null} placeholder="Optional" data={subcategories.map((item) => item.name)} clearable onChange={(value) => updateDraft(index, { subcategory: value ?? "" })} />}
                <small>{getCategory(draft.category, customCategories).label} · {source === "device" ? "Reader" : "AI"} confidence {Math.round((analysis.splits[index]?.confidence ?? analysis.confidence) * 100)}%</small>
              </article>;
            })}
          </div>

          <button className="secondary-button add-receipt-split" disabled={drafts.length >= 20 || stage === "saving"} onClick={addSplit}><Plus size={17} />Add another split</button>
          {splitTotal !== analysis.totalMinor && <p className="receipt-total-error">Adjust the splits by {formatMoney(Math.abs(analysis.totalMinor - splitTotal), currency)} so they exactly match the receipt total.</p>}
          {drafts[0]?.paymentMode === "online" && !drafts[0]?.paymentAccountId && <p className="receipt-total-error">Choose the payment account used for this receipt.</p>}
          <FormError message={error} />
          <div className="dialog-actions">
            <button className="secondary-button" disabled={stage === "saving"} onClick={() => void close()}>Cancel</button>
            <button className="primary-button" disabled={!canSave || (drafts[0]?.paymentMode === "online" && !drafts[0]?.paymentAccountId)} onClick={() => void save()}>{stage === "saving" ? <><ButtonSpinner />Adding…</> : <><Sparkle size={17} />Add {drafts.length} {drafts.length === 1 ? "transaction" : "transactions"}</>}</button>
          </div>
        </div>}
      </section>
    </AnimatedOverlay>
  </>;
}
