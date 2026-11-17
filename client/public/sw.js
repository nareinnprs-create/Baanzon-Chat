/* Baanzon Chat web push service worker: shows notifications pushed from the
 * server and opens the linked page on click. No model or endpoint metadata is
 * ever present in a payload — servers send user-facing title/body/link only. */

self.addEventListener('install', (event) => {
  // Offline fallback for navigations: the shell needs a network round-trip
  // (versioned assets), so a cached HTML page is the only reliable offline UX.
  event.waitUntil(
    caches
      .open('baanzon-offline-v1')
      .then((cache) => cache.add('/offline.html'))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** Navigation requests only: network first, offline page on failure. Every
 *  other request passes through untouched — this worker never caches app
 *  assets or API traffic. */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') {
    return;
  }
  event.respondWith(
    fetch(request).catch(() =>
      caches.match('/offline.html').then(
        (cached) =>
          cached ||
          new Response('<h1>You are offline</h1>', {
            status: 503,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    ),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_err) {
    payload = {};
  }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Baanzon Chat';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : undefined,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { link: typeof payload.link === 'string' ? payload.link : '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const url = new URL(client.url);
        if (url.pathname === link && 'focus' in client) {
          return client.focus();
        }
      }
      if (clientList.length > 0 && 'focus' in clientList[0]) {
        return clientList[0].focus();
      }
      return self.clients.openWindow(link);
    }),
  );
});
