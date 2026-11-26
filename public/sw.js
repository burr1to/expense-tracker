/* SaveYoRupee service worker: an offline page, fast repeat loads, notifications on Android, and
 * the Share-sheet inbox. Never touches /api/* or any other non-GET, so ledger data always comes
 * from the server. The one POST it answers is a share, which it keeps on this device. */
const VERSION = "syr-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const STATIC_LIMIT = 240;

// Must match src/lib/shared-inbox.ts. Not "syr-" prefixed, so a version bump never wipes a share in flight.
const SHARE_PATH = "/share-target";
const SHARE_CACHE = "saveyorupee-share";
const SHARE_META_KEY = "/__share/meta";
const SHARE_FILE_KEY = "/__share/file";
const SHARE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
// A full-size phone photo; the receipt scanner shrinks it before anything is uploaded.
const SHARE_MAX_FILE_BYTES = 25 * 1024 * 1024;
const SHARE_MAX_TEXT = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
    await cache.addAll(["/icons/icon-192.png", "/icon.svg"]).catch(() => undefined);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("syr-") && !name.startsWith(`${VERSION}-`)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/icons/")
    || url.pathname === "/icon.svg"
    || url.pathname.startsWith("/apple-icon")
    || /\.(?:woff2?|ttf|otf)$/.test(url.pathname);
}

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT)).map((key) => cache.delete(key)));
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    void trim(cache);
  }
  return response;
}

async function networkFirstPage(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? new Response("You’re offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

/** Parks a shared photo or text in the share inbox and opens the app, which picks it up from there. */
async function receiveShare(request) {
  const back = (state) => Response.redirect(new URL(`/?share=${state}`, self.location.origin).href, 303);
  try {
    const form = await request.formData();
    const field = (name) => {
      const value = form.get(name);
      return typeof value === "string" ? value.slice(0, SHARE_MAX_TEXT) : "";
    };
    const file = form.getAll("receipt").find((value) => typeof value !== "string"
      && SHARE_IMAGE_TYPES.includes(value.type) && value.size > 0 && value.size <= SHARE_MAX_FILE_BYTES);
    await caches.delete(SHARE_CACHE);
    const cache = await caches.open(SHARE_CACHE);
    if (file) {
      await cache.put(SHARE_FILE_KEY, new Response(file, {
        headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name || "shared-receipt") },
      }));
    }
    const meta = { receivedAt: Date.now(), text: field("text"), title: field("title"), hasFile: Boolean(file) };
    await cache.put(SHARE_META_KEY, new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
    return back("1");
  } catch {
    return back("failed");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === SHARE_PATH) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (isStatic(url)) event.respondWith(cacheFirst(request));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) return open.focus();
    return self.clients.openWindow(target);
  })());
});
