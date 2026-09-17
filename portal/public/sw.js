/* Service Worker — app shell per a POLSER Portal Partners (v8)
 * IMPORTANT: el portal, l'admin (/_/) i l'API (/api/*) viuen al MATEIX
 * origen (PocketBase). El SW MAI ha de cachejar ni /api/* ni /_/:
 * aquestes respostes sempre van a la xarxa.
 *
 * Estratègia (fix deploys estancats):
 *  - Navegació (HTML): NETWORK-FIRST. Així una versió nova del portal
 *    (index + assets amb hash nou) s'agafa sempre de la xarxa i no es
 *    queda servint un index.html antic de la cache. Offline: cau a cache.
 *  - Assets amb hash (JS/CSS/icons): cache-first (segur, el nom canvia).
 *  - Push (ntfy/Web Push): mostra la notificació del sistema i, en clicar,
 *    obre/focalitza la PWA al deep-link indicat.
 */
const CACHE_NAME = 'polser-partners-v9';
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

  // Navegació (HTML): network-first, per no quedar-nos amb un index vell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Altres assets: cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached || Response.error());
    })
  );
});

/* ------------------------------------------------------------------
 * Web Push (ntfy) — notificacions en segon pla
 * ntfy embolcalla el missatge així:
 *   { event:"message", subscription_id:"<base>/<topic>",
 *     message: { title, message, click, priority, tags, ... } }
 * Cal DESEMBOLICAR `message` (és un objecte, no una string). També
 * s'accepta l'embolcall { notification: {...} } per robustesa.
 * ------------------------------------------------------------------ */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    try { data = { message: event.data ? event.data.text() : '' }; } catch (__) { data = {}; }
  }

  const wrapping = (data && typeof data === 'object') ? data : {};
  let msg = wrapping;
  if (wrapping.message && typeof wrapping.message === 'object') msg = wrapping.message;
  if (wrapping.notification && typeof wrapping.notification === 'object') msg = wrapping.notification;

  // La subscripció està a punt de caducar: demanem als clients oberts que la
  // renovin (ensurePushSubscription) i mostrem una notificació informativa.
  const expiring = wrapping.event === 'subscription_expiring';

  const title = (msg && msg.title) || 'POLSER SEGURETAT';
  const body = (msg && (msg.message || msg.body)) ||
    (expiring ? 'Cal renovar les notificacions. Obriu el portal per fer-ho.' : '');
  const url = (msg && msg.click) || '/notifications';

  event.waitUntil((async () => {
    if (expiring) {
      try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of clients) {
          try { c.postMessage({ type: 'push-subscription-expiring' }); } catch (_) { /* ignore */ }
        }
      } catch (_) { /* ignore */ }
    }
    await self.registration.showNotification(title, {
      body: body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-64.png',
      data: { url: url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(target);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// Si la subscripció caduca, la PWA la renova en obrir-se (ensurePushSubscription).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(Promise.resolve());
});
