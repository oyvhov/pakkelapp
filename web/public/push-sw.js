// Varsel på telefonen. Blir lasta inn i service workeren som Vite lagar.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* ugyldig innhald */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Pakkelapp', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((w) => 'focus' in w);
    if (open) return open.navigate(url).then((w) => (w || open).focus());
    return self.clients.openWindow(url);
  }));
});

// Ikona og manifestet skiftar med sesongen. Hent dei alltid frå serveren, ikkje frå lageret.
const SEASON_ASSET = /^\/(manifest\.webmanifest|favicon(-fest)?\.svg|icon-[\w-]+\.png|apple-touch-icon(-fest)?\.png)$/;
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && SEASON_ASSET.test(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((r) => r || Response.error())));
  }
});
