// Service worker mínimo — só entrega Web Push. Sem cache/fetch handler
// de propósito, para não interferir com o carregamento normal da SPA.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}

  const title = data.title || 'Plandese';
  const options = {
    body: data.body || '',
    icon: '/plandese_logo.png',
    badge: '/plandese_logo.png',
    data: { url: data.url || '/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  const seccao = new URL(url, self.location.origin).searchParams.get('open');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          // App já aberta: pede-lhe para navegar internamente (sem recarregar/perder estado)
          if (seccao) client.postMessage({ type: 'notif-open', seccao });
          return;
        }
      }
      // Nenhuma janela aberta: abre uma nova já com a secção no URL
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
