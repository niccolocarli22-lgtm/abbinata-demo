const CACHE_NAME = 'abbinata-v4-stylist';
const assets = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Forza l'installazione immediata
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(assets)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key); // Elimina le vecchie versioni bloccate
        }
      }));
    }).then(() => self.clients.claim())
  );
});

// Network-First strategy per garantire sempre caricamento file aggiornati
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
