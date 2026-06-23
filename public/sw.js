// YTGrab 簡易 Service Worker：快取 app shell，讓網站可安裝、靜態資源離線可開
const CACHE = "ytgrab-v1";
const ASSETS = [
  "/", "/index.html", "/style.css",
  "/app.js", "/batch-download.js", "/download-history.js",
  "/burn.js", "/toolbox.js", "/transcribe.js",
  "/manifest.json", "/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 只快取本站靜態資源；API / socket.io / 跨來源一律走網路
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api") || url.pathname.startsWith("/socket.io")) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("/index.html")))
  );
});
