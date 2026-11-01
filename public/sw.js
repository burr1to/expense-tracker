/* SaveYoRupee service worker: an offline page, fast repeat loads, and notifications on Android.
 * Never touches /api/* or anything that is not a GET, so ledger data always comes from the server. */
const VERSION = "syr-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const STATIC_LIMIT = 240;

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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
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
