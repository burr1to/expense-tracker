import { FilePdf, Image as ImageIcon, X } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import type { ReceiptMeta } from "../types";

interface ReceiptPreviewProps {
  receipt: ReceiptMeta;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function ReceiptPreview({ receipt, children, className, ariaLabel }: ReceiptPreviewProps) {
  const [open, setOpen] = useState(false);
  const source = `/api/receipts/${receipt.id}`;
  const isPdf = receipt.mimeType === "application/pdf";

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return <>
    <button type="button" className={className} onClick={() => setOpen(true)} aria-label={ariaLabel ?? `Preview receipt ${receipt.name}`}>{children}</button>
    {open && <div className="modal-backdrop receipt-preview-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section className="receipt-preview-dialog" role="dialog" aria-modal="true" aria-labelledby={`receipt-title-${receipt.id}`}>
        <header>
          <div className="receipt-preview-title">
            <span>{isPdf ? <FilePdf size={22} weight="duotone" /> : <ImageIcon size={22} weight="duotone" />}</span>
            <div><small>Receipt preview</small><h2 id={`receipt-title-${receipt.id}`}>{receipt.name}</h2></div>
          </div>
          <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close receipt preview"><X size={21} /></button>
        </header>
        <div className="receipt-preview-canvas">
          {isPdf ? <iframe src={`${source}#toolbar=0&navpanes=0`} title={`Receipt ${receipt.name}`} /> : <img src={source} alt={`Receipt ${receipt.name}`} draggable={false} />}
        </div>
      </section>
    </div>}
  </>;
}
