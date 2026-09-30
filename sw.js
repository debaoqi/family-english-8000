// Bump VERSION whenever the app files change so installed apps pick up the update.
const VERSION = 'fe-v2';
// Audio never changes for a given file name (names are content hashes), so it lives in its
// own cache that survives app updates.
const AUDIO_CACHE = 'fe-audio';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'data.json'
];

// Cache each file separately: on a slow or unstable connection one failed download must not
// make the whole service worker (and therefore "install app") fail.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== AUDIO_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/audio/')) {
    // Audio: cache first; store full responses only (range requests come back as 206).
    event.respondWith(
      caches.open(AUDIO_CACHE).then(cache => cache.match(url.href).then(hit => hit || fetch(url.href).then(res => {
        if (res.status === 200) cache.put(url.href, res.clone());
        return res;
      })))
    );
    return;
  }

  // App shell and data: cache first, refresh in the background.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
      return cached || network;
    })
  );
});
