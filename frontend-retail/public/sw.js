// Runs outside the page, even when no tab is open — this is what makes
// push notifications work while the app isn't focused (the whole reason
// this exists separately from the in-app websocket handling).

self.addEventListener('push', (event) => {
  let data = { title: 'Swag Gold', body: 'You have a new notification', url: self.registration.scope };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) { /* fall back to defaults above */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: self.registration.scope + 'logo.png',
      badge: self.registration.scope + 'logo.png',
      tag: data.tag, // same tag replaces the previous notification instead of stacking
      data: { url: data.url || self.registration.scope },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Reuse an already-open tab instead of piling up new ones.
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
