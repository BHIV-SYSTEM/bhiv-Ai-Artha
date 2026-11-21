/* Push service worker — drop into your app's public/ folder and register
   via the usePushNotifications hook (or your own registration code). */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = { title: 'Notification', body: '' };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data ? event.data.text() : '';
  }

  const priority = payload.priority || 'normal';
  const options = {
    body: payload.body || '',
    badge: '/badge.png',
    icon: '/icon.png',
    vibrate: [100, 50, 100],
    tag: payload.tag || 'notification',
    renotify: true,
    requireInteraction: priority === 'high' || priority === 'urgent',
    data: { url: payload.link || payload.data?.url || '/' },
  };
  if (payload.actions?.length) options.actions = payload.actions;

  event.waitUntil(self.registration.showNotification(payload.title || 'Notification', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) return client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
