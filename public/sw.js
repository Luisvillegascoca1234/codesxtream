// Bump this version when changing any precached file.
const CACHE = 'xtremeville-static-v6';
const STATIC_FILES = [
  '/offline.html', '/styles.css', '/app.js', '/pwa.js', '/icon.svg',
  '/manifest.webmanifest', '/vendor/hls.min.js', '/icons/icon-192.png',
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
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      return await cache.match('/offline.html') || Response.error();
    }));
  } else if (STATIC_PATHS.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(url.pathname) || fetch(request);
    })());
  }
});
