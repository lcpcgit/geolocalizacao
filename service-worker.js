const CACHE_NAME = 'pesquisa-opiniao-v2';

const ASSETS = [
    '/login',
    '/static/index.html',
    '/static/mapa.html',
    '/static/manifest.json',
    '/service-worker.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
            });
            return networkResponse;
        }).catch(() => {
            return caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                if (event.request.mode === 'navigate') {
                    return caches.match('/static/index.html');
                }
                return new Response('', {
                    status: 408,
                    statusText: 'Offline'
                });
            });
        })
    );
});
