const BASE_PATH = new URL(self.registration.scope).pathname;
const CACHE_PREFIX = `babysteps:${BASE_PATH}:`;
const CACHE_NAME = `${CACHE_PREFIX}v4`;
const CORE_ASSETS = [
  BASE_PATH,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}icons/icon-192.png`,
  `${BASE_PATH}icons/icon-512.png`,
  `${BASE_PATH}icons/maskable-512.png`
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) =>
    (key.startsWith(CACHE_PREFIX) || /^babysteps-v\d+$/.test(key)) && key !== CACHE_NAME).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Authenticated responses belong only in account/family-scoped IndexedDB.
  // Never cache API responses, even if a fetch fails or returns an error page.
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE_PATH) ||
      url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && !response.headers.get('Cache-Control')?.includes('no-store')) {
      const copy = response.clone(); void caches.open(CACHE_NAME).then((cache) => cache.put(request,copy));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match(BASE_PATH); if (shell) return shell;
    }
    return Response.error();
  }));
});
