import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHARED_TEXT_LIMIT } from "./app-shell";
import { SHARE_CACHE, SHARE_FILE_KEY, SHARE_MAX_AGE_MS, SHARE_META_KEY, takeSharedItem, type ShareCacheStorage } from "./shared-inbox";
import manifest from "../app/manifest";

const NOW = 1_800_000_000_000;

/** An in-memory Cache Storage holding what public/sw.js would have parked. */
function inbox(entries: Record<string, Response> | null) {
  const caches = new Map<string, Map<string, Response>>();
  if (entries) caches.set(SHARE_CACHE, new Map(Object.entries(entries)));
  const storage: ShareCacheStorage = {
    open: async (name) => {
      if (!caches.has(name)) caches.set(name, new Map());
      const cache = caches.get(name)!;
      return { match: async (key: RequestInfo | URL) => cache.get(String(key)) } as Pick<Cache, "match">;
    },
    delete: async (name) => caches.delete(name),
  };
  return { storage, isEmpty: () => !caches.get(SHARE_CACHE)?.size };
}

const meta = (fields: Record<string, unknown>) => new Response(JSON.stringify({ receivedAt: NOW, text: "", title: "", hasFile: false, ...fields }));
const photo = (bytes = "jpeg-bytes") => new Response(new Blob([bytes], { type: "image/jpeg" }), { headers: { "Content-Type": "image/jpeg", "X-File-Name": encodeURIComponent("bill 1.jpg") } });

describe("takeSharedItem", () => {
  it("hands over shared SMS text, falling back to the title, capped at the SMS sheet's limit", async () => {
    expect(await takeSharedItem(inbox({ [SHARE_META_KEY]: meta({ text: "  Rs 500 debited ", title: "NABIL" }) }).storage, NOW)).toEqual({ type: "text", text: "Rs 500 debited" });
    expect(await takeSharedItem(inbox({ [SHARE_META_KEY]: meta({ title: "Rs 500 debited" }) }).storage, NOW)).toEqual({ type: "text", text: "Rs 500 debited" });
    const long = await takeSharedItem(inbox({ [SHARE_META_KEY]: meta({ text: "9".repeat(SHARED_TEXT_LIMIT + 50) }) }).storage, NOW);
    expect(long).toEqual({ type: "text", text: "9".repeat(SHARED_TEXT_LIMIT) });
  });

  it("hands over a shared photo with its name and type, ahead of any caption", async () => {
    const item = await takeSharedItem(inbox({ [SHARE_META_KEY]: meta({ hasFile: true, text: "lunch" }), [SHARE_FILE_KEY]: photo() }).storage, NOW);
    expect(item?.type).toBe("receipt");
    if (item?.type !== "receipt") return;
    expect(item.file.name).toBe("bill 1.jpg");
    expect(item.file.type).toBe("image/jpeg");
    expect(await item.file.text()).toBe("jpeg-bytes");
  });

  it("falls back to the text when the photo went missing", async () => {
    expect(await takeSharedItem(inbox({ [SHARE_META_KEY]: meta({ hasFile: true, text: "Rs 90 paid" }) }).storage, NOW)).toEqual({ type: "text", text: "Rs 90 paid" });
  });

  it("empties the inbox every time, so a share opens once", async () => {
    const box = inbox({ [SHARE_META_KEY]: meta({ text: "Rs 500 debited" }) });
    await takeSharedItem(box.storage, NOW);
    expect(box.isEmpty()).toBe(true);
    expect(await takeSharedItem(box.storage, NOW)).toBeNull();
  });

  it("drops stale, empty, malformed or missing shares", async () => {
    const stale = inbox({ [SHARE_META_KEY]: meta({ text: "Rs 500 debited", receivedAt: NOW - SHARE_MAX_AGE_MS - 1 }) });
    expect(await takeSharedItem(stale.storage, NOW)).toBeNull();
    expect(stale.isEmpty()).toBe(true);
    expect(await takeSharedItem(inbox({ [SHARE_META_KEY]: meta({ text: "   " }) }).storage, NOW)).toBeNull();
    expect(await takeSharedItem(inbox({ [SHARE_META_KEY]: new Response("not json") }).storage, NOW)).toBeNull();
    expect(await takeSharedItem(inbox(null).storage, NOW)).toBeNull();
    expect(await takeSharedItem(undefined, NOW)).toBeNull();
  });
});

describe("share target wiring", () => {
  it("posts shares to the path the service worker answers, with the names it reads", () => {
    const worker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    const constant = (name: string) => worker.match(new RegExp(`const ${name} = "([^"]+)"`))?.[1];
    const target = manifest().share_target;
    expect(target?.method).toBe("POST");
    expect(target?.enctype).toBe("multipart/form-data");
    expect(constant("SHARE_PATH")).toBe(target?.action);
    expect(constant("SHARE_CACHE")).toBe(SHARE_CACHE);
    expect(constant("SHARE_META_KEY")).toBe(SHARE_META_KEY);
    expect(constant("SHARE_FILE_KEY")).toBe(SHARE_FILE_KEY);
    const files = target?.params.files;
    expect(Array.isArray(files) ? files[0]?.name : files?.name).toBe("receipt");
    expect(worker).toContain('form.getAll("receipt")');
    // A version bump clears every "syr-" cache, which must never include a share in flight.
    expect(SHARE_CACHE.startsWith("syr-")).toBe(false);
  });
});
