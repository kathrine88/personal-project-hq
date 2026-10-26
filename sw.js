// Stage 3C-A: lifecycle foundation only. Deliberately no fetch handler,
// Cache Storage, offline app shell, push handlers or notification permissions.
// Supabase requests and private files retain the browser's normal network path.
self.addEventListener('install', event => {
  // Safe while this worker never intercepts requests. Revisit if caching is added.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
