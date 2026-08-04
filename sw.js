// Service Worker du Portail Roadbook VE
// - Met en cache l'app shell pour un fonctionnement hors-ligne
// - Intercepte les partages Android (Web Share Target API) et les redirige vers Roadbook VE

const CACHE_NAME = 'roadbook-hub-v1';
const APP_SHELL = [
  './',
  './index.html',
  './georouter.html',
  './roadbook.html',
  './manifest.json',
  './topojson-client.min.js',
  './autoroutes_payantes.topojson',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // ne bloque pas l'installation si une ressource externe manque
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // --- Gestion du partage de fichier depuis Android (Web Share Target) ---
  if (event.request.method === 'POST' && url.pathname.endsWith('/roadbook.html')) {
    event.respondWith(handleSharedFile(event.request));
    return;
  }

  // --- Stratégie réseau d'abord, repli sur le cache (offline) pour les GET ---
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});

async function handleSharedFile(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('trace');

    if (file) {
      const cache = await caches.open('incoming-shared-files');
      const headers = new Headers({ 'x-file-name': encodeURIComponent(file.name || 'trace.gpx') });
      const response = new Response(await file.arrayBuffer(), { headers });
      await cache.put('/shared-trace-file', response);
    }
  } catch (err) {
    // Si le parsing échoue, on redirige quand même sans fichier
  }

  return Response.redirect('./roadbook.html?shared=true', 303);
}
