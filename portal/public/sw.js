/* Service Worker — app shell per a POLSER Portal Partners (v3)
 * IMPORTANT: el portal, l'admin (/_/) i l'API (/api/*) viuen al MATEIX
 * origen (PocketBase). El SW MAI ha de cachejar ni /api/* ni /_/:
 * aquestes respostes sempre van a la xarxa.
 */
const CACHE_NAME = 'polser-partners-v3';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest'];

// Instal·la el service worker i cacheja l'app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

// Neteja caches antigues
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Estratègia: cache-first per a l'app shell, network-first per a la resta
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // MAI cachejar l'API de PocketBase ni l'admin UI (mateix origen a la v2)
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_/')) return;
  // Exclusions històriques (endpoints Directus del v1); es mantenen per seguretat
  if (url.pathname.startsWith('/items/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/portal/')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});