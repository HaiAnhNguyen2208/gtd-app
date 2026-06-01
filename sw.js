/* GTD service worker — makes the app installable and fully usable offline.
 *
 * App shell (HTML + CDN React/Babel + icons) is precached on install and
 * served cache-first. The /api/* endpoints are the OPTIONAL sync hub and are
 * never intercepted — they hit the network when a server is reachable and are
 * simply allowed to fail offline (the app falls back to localStorage). */

const CACHE = "gtd-v27";

const SHELL = [
  "./",
  "manifest.webmanifest",
  "static/icons/icon.svg",
  "static/icons/icon-192.png",
  "static/icons/icon-512.png",
  "static/icons/icon-maskable-512.png",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone/babel.min.js",
  "https://unpkg.com/@azure/msal-browser@2.38.4/lib/msal-browser.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // allSettled so one flaky CDN fetch can't abort the whole install
    await Promise.allSettled(SHELL.map((u) => c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                       // POST /api/state etc. → straight to network

  const url = new URL(req.url);
  if (url.pathname.endsWith("/api/state") || url.pathname.endsWith("/api/ping")) return;
  // OneDrive auth + data must always hit the network — never cache or intercept.
  if (url.hostname === "graph.microsoft.com" || url.hostname === "login.microsoftonline.com") return;

  if (req.mode === "navigate") {                          // app shell: network, fall back to cached page
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch { return (await caches.match("./")) || (await caches.match(req)) || Response.error(); }
    })());
    return;
  }

  // assets (icons, CDN libs): cache-first, then network (and cache the result)
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch {
      return cached || Response.error();
    }
  })());
});
