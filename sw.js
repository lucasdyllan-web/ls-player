const CACHE_NAME = 'lsplay-pwa-v1';
const ASSETS = ['./', './index.html', './manifest.json', './logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin && ASSETS.some((a) => url.pathname.endsWith(a.replace('./', '')))) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  }
});
