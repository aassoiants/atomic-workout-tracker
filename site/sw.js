// Atomic service worker — precache the app shell so the gym works in airplane mode.
const CACHE = 'atomic-v27';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app/main.js',
  './app/dom.js',
  './app/ui.js',
  './app/model.js',
  './app/share.js',
  './app/store.js',
  './app/import.js',
  './app/export.js',
  './app/reconstruct.js',
  './app/screens/detail.js',
  './app/styles.css',
  './app/screens/feed.js',
  './app/screens/session.js',
  './app/screens/exercise.js',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  e.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const resp = await fetch(request);
      const url = new URL(request.url);
      if (url.origin === location.origin && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      }
      return resp;
    } catch (err) {
      if (request.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
