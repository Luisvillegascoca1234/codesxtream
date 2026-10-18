// Bump the cache and the asset versions in this file, index.html and offline.html together.
// Versioned URLs bypass older workers that still cache the unversioned app.js.
const CACHE = 'xtremeville-static-v10';
const STATIC_FILES = [
  '/offline.html', '/styles.css?v=10', '/app.js?v=10', '/pwa.js?v=10', '/icon.svg',
  '/manifest.webmanifest', '/vendor/hls.min.js?v=10', '/icons/icon-192.png',
  '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png',
];
const STATIC_PATHS = new Set(STATIC_FILES);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC_FILES.map(url => new Request(url, { cache: 'reload', credentials: 'omit' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('xtremeville-static-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // APIs, credentials, catalogues, playlists and video NEVER enter the cache.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate' && url.pathname === '/' && !url.search) {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      return await cache.match('/offline.html') || Response.error();
    }));
  } else if (STATIC_PATHS.has(url.pathname + url.search)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(url.pathname + url.search) || fetch(request);
    })());
  }
});
