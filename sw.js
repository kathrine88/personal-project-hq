// Stage 3C-B extends the existing lifecycle foundation. No fetch handler,
// Cache Storage or offline app shell. Permissions are requested only in the UI.
// Supabase requests and private files retain the browser's normal network path.
self.addEventListener('install', event => {
  // Safe while this worker never intercepts requests. Revisit if caching is added.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

const pushUuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : null;
self.addEventListener('push', event => {
  let payload = {}; try { payload = event.data?.json() || {}; } catch { /* Show a safe generic notification. */ }
  const occurrenceId = pushUuid(payload.occurrenceId);
  event.waitUntil(self.registration.showNotification('Personal Project HQ', {
    body: payload.kind === 'test'
  ? 'Your test notification arrived.'
  : (
      typeof payload.title === 'string' && payload.title.trim()
        ? payload.title.trim().slice(0, 120)
        : 'A reminder needs your attention. Open Project HQ to view it.'
    ),
    icon: new URL('images/app-icon-192.png', self.registration.scope).href,
    tag: 'hq-' + (occurrenceId || pushUuid(payload.tag) || 'notification'),
    data: { occurrenceId }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const occurrenceId = pushUuid(event.notification.data?.occurrenceId);
  const target = new URL('./', self.registration.scope); target.hash = 'reminders';
  if (occurrenceId) target.searchParams.set('reminder', occurrenceId);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => {
      const url = new URL(client.url);
      const appPath = new URL(self.registration.scope).pathname;
      return url.origin === target.origin && (url.pathname === appPath || url.pathname === appPath + 'index.html');
    });
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'HQ_OPEN_REMINDERS', occurrenceId });
    } else await self.clients.openWindow(target.href);
  })());
});
// Expiration is reconciled in settings on foreground; no auth token is stored here.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then(windows => {
    for (const client of windows) client.postMessage({ type: 'HQ_PUSH_CHANGED' });
  }));
});
