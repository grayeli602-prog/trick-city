// Offline support for Trick Map.
// App files are cached on install. Every same-origin request goes to the
// network first, so updates show up right away, and falls back to the cache
// when offline or when the network is too slow. Fonts are cached on first use.

const CACHE = "trickmap-v7";
const APP = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "css/base.css",
  "css/components.css",
  "css/app.css",
  "js/core/catalog.js",
  "js/core/store.js",
  "js/core/model.js",
  "js/core/draw.js",
  "js/app/main.js",
  "js/app/mapview.js",
  "js/app/grid.js",
  "js/app/levelpicker.js",
  "js/app/breakdown.js",
  "js/app/feet.js",
  "js/app/sheet.js",
  "js/app/settings.js",
  "js/app/ingredients.js",
  "js/app/share.js",
  "js/app/friends.js",
];
const SLOW_MS = 3500;
const ROOT = new URL("./", self.location).pathname;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function cached(req) {
  return caches.match(req, { ignoreSearch: true }).then((hit) => {
    if (hit) return hit;
    const path = new URL(req.url).pathname;
    // The app itself opened offline: serve the cached shell.
    if (req.mode === "navigate" && (path === ROOT || path === `${ROOT}index.html`)) return caches.match("index.html");
    return null;
  });
}

function networkFirst(req) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res) => {
      if (settled || !res) return;
      settled = true;
      resolve(res);
    };
    const slow = setTimeout(() => cached(req).then(finish), SLOW_MS);
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        clearTimeout(slow);
        finish(res);
      })
      .catch(() => {
        clearTimeout(slow);
        cached(req).then((hit) => finish(hit || Response.error()));
      });
  });
}

function cacheFirst(req) {
  return caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok || res.type === "opaque") {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  }));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(cacheFirst(req));
});
