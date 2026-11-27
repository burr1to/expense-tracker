"use client";

import type { Worker } from "tesseract.js";

/**
 * On-device receipt reading. Tesseract runs in a Web Worker in the browser;
 * the photo is never sent anywhere for this step. The first use downloads the
 * reader and its English language data (a few MB, then cached by the browser).
 */

const OCR_TIMEOUT_MS = 30_000;
let workerPromise: Promise<Worker> | null = null;

export interface ReceiptTextRead {
  text: string;
  /** Tesseract's mean word confidence, 0–100. */
  ocrConfidence: number;
}

/** Start loading the reader early, e.g. when the scan sheet opens. */
export function warmReceiptReader() {
  workerPromise ??= import("tesseract.js")
    .then(async ({ createWorker }) => {
      const worker = await createWorker("eng");
      await worker.setParameters({ preserve_interword_spaces: "1" });
      return worker;
    })
    .catch((error: unknown) => {
      workerPromise = null;
      throw error;
    });
  return workerPromise;
}

export async function readReceiptText(image: Blob): Promise<ReceiptTextRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("Reading the receipt on this phone took too long."));
    }, OCR_TIMEOUT_MS);
  });
  try {
    const worker = await Promise.race([warmReceiptReader(), timeout]);
    const { data } = await Promise.race([worker.recognize(image), timeout]);
    return { text: data.text, ocrConfidence: data.confidence };
  } catch (error) {
    // A stuck worker would hold the next scan in its queue; start fresh instead.
    if (timedOut) await releaseReceiptReader();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Free the worker's memory once the scan sheet closes. */
export async function releaseReceiptReader() {
  const pending = workerPromise;
  workerPromise = null;
  const worker = await pending?.catch(() => null);
  await worker?.terminate();
}
