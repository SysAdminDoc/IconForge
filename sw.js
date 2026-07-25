importScripts('./version.js');

const CACHE_NAME = `iconforge-${globalThis.ICONFORGE_VERSION}`;
const SHELL_URL = './index.html';
const ASSETS = [
  './',
  SHELL_URL,
  './version.js',
  './app.js',
  './styles.css',
  './icon.png',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => clients.forEach(client => client.postMessage({ type: 'ICONFORGE_SW_ACTIVATED' })))
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const isHTML = e.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');

  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            e.waitUntil(
              caches.open(CACHE_NAME).then(cache => Promise.all([
                cache.put(e.request, clone),
                cache.put(SHELL_URL, response.clone())
              ]))
            );
          }
          return response;
        })
        .catch(async () => (
          await caches.match(e.request) ||
          await caches.match(SHELL_URL) ||
          Response.error()
        ))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(async cached => {
        if (cached) return cached;
        try {
          const response = await fetch(e.request);
          if (response.ok) {
            const clone = response.clone();
            e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone)));
          }
          return response;
        } catch {
          return Response.error();
        }
      })
    );
  }
});
