import { STATEMENT_MAX_IMAGES, statementAnalysisRequestSchema } from "./statement-analysis";
import { prepareReceiptPhoto } from "./receipts";

export interface StatementSourcePayload {
  name: string;
  text?: string;
  images?: { mimeType: "image/jpeg" | "image/png" | "image/webp"; data: string }[];
  warnings: string[];
}

const MAX_STATEMENT_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 10;

function base64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

async function blobImage<T extends "image/jpeg" | "image/png" | "image/webp">(blob: Blob, mimeType: T): Promise<{ mimeType: T; data: string }> {
  return { mimeType, data: base64(new Uint8Array(await blob.arrayBuffer())) };
}

async function pdfPayload(file: File): Promise<StatementSourcePayload> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const pdf = await loadingTask.promise;
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const pageText: string[] = [];
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ").replace(/\s+/g, " ").trim();
      if (text) pageText.push(`Page ${pageNumber}\n${text}`);
    }
    const warnings = pdf.numPages > MAX_PDF_PAGES ? [`Only the first ${MAX_PDF_PAGES} of ${pdf.numPages} pages were analyzed.`] : [];
    const text = pageText.join("\n\n").slice(0, 120_000);
    if (text.length >= 80) return { name: file.name, text, warnings };

    const images: { mimeType: "image/jpeg"; data: string }[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, STATEMENT_MAX_IMAGES); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1600 / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not render this statement PDF.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not prepare this statement page.")), "image/jpeg", 0.82));
      images.push(await blobImage(blob, "image/jpeg"));
    }
    warnings.push("This scanned PDF was analyzed from rendered page images; review dates and amounts carefully.");
    return { name: file.name, images, warnings };
  } finally {
    await loadingTask.destroy();
  }
}

export async function prepareStatementSource(file: File): Promise<StatementSourcePayload> {
  if (!file.size) throw new Error("This statement file is empty.");
  if (file.size > MAX_STATEMENT_BYTES) throw new Error("Keep statement files under 15 MB.");
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return pdfPayload(file);
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    const prepared = await prepareReceiptPhoto(file);
    return { name: file.name, images: [await blobImage(prepared, "image/jpeg")], warnings: ["This image statement was resized, stripped of EXIF metadata, and read with AI. Review every extracted row."] };
  }
  if (file.type.startsWith("text/") || /\.(csv|txt)$/i.test(file.name)) return { name: file.name, text: (await file.text()).slice(0, 120_000), warnings: [] };
  throw new Error("Use a CSV, text, PDF, JPG, PNG, or WebP statement.");
}

export async function analyzeStatementFile(file: File) {
  const source = await prepareStatementSource(file);
  const payload = statementAnalysisRequestSchema.parse(source);
  const response = await fetch("/api/imports/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json() as { analysis?: { rows: import("../types").TransactionDraft[]; warnings: string[] }; error?: string };
  if (!response.ok || !body.analysis) throw new Error(body.error ?? "Could not analyze this statement.");
  return { ...body.analysis, warnings: [...source.warnings, ...body.analysis.warnings] };
}
