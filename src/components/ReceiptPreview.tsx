import { FilePdf, Image as ImageIcon, X } from "@phosphor-icons/react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReceiptMeta } from "../types";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { ButtonSpinner } from "./ButtonSpinner";

interface ReceiptPreviewProps {
  receipt: ReceiptMeta;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

function PdfPreview({ name, source }: { name: string; source: string }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ rendered: 0, total: 0 });

  useEffect(() => {
    const container = pagesRef.current;
    if (!container) return;

    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;

    const render = async () => {
      try {
        const response = await fetch(source);
        if (!response.ok) throw new Error("Could not load this receipt.");

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        loadingTask = pdfjs.getDocument({ data: await response.arrayBuffer() });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setProgress({ rendered: 0, total: pdf.numPages });
        const availableWidth = Math.max(280, container.clientWidth);

        for (let pageNumber = 1; pageNumber <= pdf.numPages && !cancelled; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const naturalViewport = page.getViewport({ scale: 1 });
          const displayScale = Math.min(1, availableWidth / naturalViewport.width);
          const outputScale = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: displayScale * outputScale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / outputScale)}px`;
          canvas.style.height = `${Math.floor(viewport.height / outputScale)}px`;
          canvas.setAttribute("aria-label", `Page ${pageNumber} of ${pdf.numPages}`);
          container.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
          if (!cancelled) setProgress({ rendered: pageNumber, total: pdf.numPages });
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not preview this receipt.");
      }
    };

    void render();
    return () => {
      cancelled = true;
      container.replaceChildren();
      void loadingTask?.destroy();
    };
  }, [source]);

  if (error) return <p className="receipt-preview-error" role="alert">{error}</p>;
  return <>
    <div ref={pagesRef} className="receipt-pdf-pages" aria-label={`PDF receipt ${name}`} aria-busy={progress.total === 0 || progress.rendered < progress.total} />
    {(progress.total === 0 || progress.rendered < progress.total) && <div className="receipt-preview-loading" role="status"><ButtonSpinner /><span>{progress.total ? `Rendering page ${progress.rendered + 1} of ${progress.total}…` : "Loading receipt…"}</span></div>}
  </>;
}

export function ReceiptPreview({ receipt, children, className, ariaLabel }: ReceiptPreviewProps) {
  const [open, setOpen] = useState(false);
  const source = `/api/receipts/${receipt.id}`;
  const isPdf = receipt.mimeType === "application/pdf";

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <>
    <button type="button" className={className} onClick={() => setOpen(true)} aria-label={ariaLabel ?? `Preview receipt ${receipt.name}`}>{children}</button>
    <AnimatedOverlay open={open} className="receipt-preview-backdrop" dismissOnBackdrop onClose={() => setOpen(false)}>
      <section className="receipt-preview-dialog" role="dialog" aria-modal="true" aria-labelledby={`receipt-title-${receipt.id}`}>
        <header>
          <div className="receipt-preview-title">
            <span>{isPdf ? <FilePdf size={22} weight="duotone" /> : <ImageIcon size={22} weight="duotone" />}</span>
            <div><small>Receipt preview</small><h2 id={`receipt-title-${receipt.id}`}>{receipt.name}</h2></div>
          </div>
          <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close receipt preview" autoFocus><X size={21} /></button>
        </header>
        <div className="receipt-preview-canvas">
          {isPdf ? <PdfPreview name={receipt.name} source={source} /> : <img src={source} alt={`Receipt ${receipt.name}`} draggable={false} />}
        </div>
      </section>
    </AnimatedOverlay>
  </>;
}
