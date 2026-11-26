import { SHARED_TEXT_LIMIT } from "./app-shell";

/*
 * Android's Share sheet posts shared text and photos to /share-target. The service worker
 * (public/sw.js) answers that POST itself: it parks what was shared in this cache and redirects
 * to /?share=1, so a bank SMS or receipt photo never travels to the server just to be handed back.
 * These names must match the ones in public/sw.js; a test pins them.
 */
export const SHARE_CACHE = "saveyorupee-share";
export const SHARE_META_KEY = "/__share/meta";
export const SHARE_FILE_KEY = "/__share/file";
/** A share older than this was never picked up (signed out, abandoned) and is dropped. */
export const SHARE_MAX_AGE_MS = 10 * 60_000;

export type SharedItem = { type: "receipt"; file: File } | { type: "text"; text: string };

interface ShareMeta { receivedAt: number; text: string; title: string; hasFile: boolean }

type ShareCache = Pick<Cache, "match">;
export interface ShareCacheStorage {
  open(name: string): Promise<ShareCache>;
  delete(name: string): Promise<boolean>;
}

function readMeta(value: unknown): ShareMeta | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.receivedAt !== "number") return null;
  return {
    receivedAt: raw.receivedAt,
    text: typeof raw.text === "string" ? raw.text : "",
    title: typeof raw.title === "string" ? raw.title : "",
    hasFile: raw.hasFile === true,
  };
}

function fileName(header: string | null) {
  try { return header ? decodeURIComponent(header) : "shared-receipt"; } catch { return "shared-receipt"; }
}

/**
 * Takes the waiting share out of the inbox, once: the inbox is emptied whatever it held. A photo
 * wins over text, since a photo shared with a caption is still a receipt.
 */
export async function takeSharedItem(storage: ShareCacheStorage | undefined, now = Date.now()): Promise<SharedItem | null> {
  if (!storage) return null;
  try {
    const cache = await storage.open(SHARE_CACHE);
    const metaResponse = await cache.match(SHARE_META_KEY);
    const meta = metaResponse ? readMeta(await metaResponse.json().catch(() => null)) : null;
    if (!meta) return null;
    const age = now - meta.receivedAt;
    if (age > SHARE_MAX_AGE_MS || age < -60_000) return null;
    if (meta.hasFile) {
      const fileResponse = await cache.match(SHARE_FILE_KEY);
      if (fileResponse) {
        const blob = await fileResponse.blob();
        const type = blob.type || fileResponse.headers.get("Content-Type") || "";
        return { type: "receipt", file: new File([blob], fileName(fileResponse.headers.get("X-File-Name")), { type }) };
      }
    }
    const text = (meta.text.trim() || meta.title.trim()).slice(0, SHARED_TEXT_LIMIT);
    return text ? { type: "text", text } : null;
  } finally {
    await storage.delete(SHARE_CACHE).catch(() => false);
  }
}

/** The browser's Cache Storage, when this page has it (it needs a secure origin). */
export function shareCacheStorage(): ShareCacheStorage | undefined {
  return typeof caches === "undefined" ? undefined : caches;
}
