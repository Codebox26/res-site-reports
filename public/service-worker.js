/**
 * service-worker.js — minimal PWA service worker.
 * Caches the app shell for offline access.
 * API requests are NOT cached — they fall through to the offline queue logic in app.js.
 */

const CACHE_NAME = 'res-reports-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/report.html',
  '/admin.html',
  '/css/style.css',
  '/js/app.js',
  '/js/api.js',
  '/js/photos.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Use individual try-catch so one missing file doesn't break the whole install
      return Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
    })
  );
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy: cache-first for app shell assets, network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin requests
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API calls: always go to network (offline handled in app.js via IndexedDB queue)
  if (url.pathname.startsWith('/api/')) return;

  // App shell: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Cache valid responses for app shell files
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Fallback: return index.html for navigation requests when offline
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
