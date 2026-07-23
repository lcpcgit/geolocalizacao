const CACHE_NAME = 'pesquisa-opiniao-v3';

const OFFLINE_PAGE = '/static/index.html';
const ASSETS = [
    '/',
    OFFLINE_PAGE,
    '/static/index.html?v=20260722-pesquisa-opiniao',
    '/static/manifest.json',
    '/service-worker.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await Promise.allSettled(
                ASSETS.map(async (url) => {
                    const response = await fetch(url, { cache: 'reload' });
                    if (response.ok || response.type === 'opaqueredirect') {
                        await cache.put(url, response);
                    }
                })
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.map((key) => {
                if (key !== CACHE_NAME) return caches.delete(key);
            }));
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const isSameOrigin = url.origin === self.location.origin;

    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirst(event.request, OFFLINE_PAGE));
        return;
    }

    if (isSameOrigin) {
        event.respondWith(networkFirst(event.request));
    }
});

async function networkFirst(request, fallbackUrl) {
    const cache = await caches.open(CACHE_NAME);

    try {
        const response = await fetch(request);
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) return cachedResponse;
        if (fallbackUrl) return cache.match(fallbackUrl);
        return new Response('', { status: 408, statusText: 'Offline' });
    }
}
