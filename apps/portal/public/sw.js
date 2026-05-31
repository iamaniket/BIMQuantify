// Minimal offline-shell service worker for the BIMstitch portal.
// Strategy:
//   - GET navigations: network-first, fall back to the cached "/" shell when offline.
//   - Other GETs to same-origin static assets: stale-while-revalidate against a runtime cache.
//   - Anything else (POST/PUT, cross-origin API): pass straight through to the network.

const SHELL_CACHE = 'bimstitch-shell-v2';
const RUNTIME_CACHE = 'bimstitch-runtime-v1';
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/', fresh.clone()).catch(() => undefined);
          return fresh;
        } catch {
          const cached = await caches.match('/');
          if (cached) return cached;
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/web-ifc/') || url.pathname.startsWith('/fragments/') || url.pathname.startsWith('/fonts/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone()).catch(() => undefined);
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })(),
    );
  }
});
