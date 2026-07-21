/* ==========================================================================
   sw.js — Service Worker: Anime Watchlist PWA
   Estratégia: Cache-First para assets estáticos, Network-First para dados.
   ========================================================================== */

const CACHE_NAME = 'anime-watchlist-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles/styles.css',
  './scripts/storage.js',
  './scripts/ui.js',
  './scripts/app.js',
  './data/animes-seed.js',
  './manifest.json',
  './images/favicon.svg',
  './images/spring-icon.png',
  './images/summer-icon.png',
  './images/autumn-icon.png',
  './images/winter-icon.png',
];

/* ---- Install: pré-cacheia todos os assets estáticos ---- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

/* ---- Activate: remove caches antigos ---- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ---- Fetch: Cache-First para assets, Network-First para dados ---- */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requisições não-GET e cross-origin (ex: Google Fonts)
  if (request.method !== 'GET') return;
  if (url.origin !== location.origin) {
    // Para fontes externas: stale-while-revalidate
    if (url.hostname.includes('googleapis') || url.hostname.includes('gstatic')) {
      event.respondWith(
        caches.open(CACHE_NAME).then(cache =>
          cache.match(request).then(cached => {
            const networkFetch = fetch(request).then(response => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            }).catch(() => cached);
            return cached || networkFetch;
          })
        )
      );
    }
    return;
  }

  // Para data/animes.json: Network-First (dados podem mudar)
  if (url.pathname.includes('animes.json')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Para o restante: Cache-First
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        }
        return response;
      });
    })
  );
});
