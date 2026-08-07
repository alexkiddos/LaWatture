// Service Worker du Portail Roadbook VE
// - Met en cache l'app shell pour un fonctionnement hors-ligne
// - Intercepte les partages Android (Web Share Target API) et les redirige vers Roadbook VE

const CACHE_NAME = 'roadbook-hub-v6.3';
const APP_SHELL = [
  './',
  './index.html',
  './georouter.html',
  './roadbook.html',
  './manifest.json',
  './autoroutes_payantes_surcouche.geojson',
  './icon-192.png',
  './icon-512.png',
  './icons/dark/direction_arrive.png',
  './icons/light/direction_arrive.png',
  './icons/dark/direction_arrive_left.png',
  './icons/light/direction_arrive_left.png',
  './icons/dark/direction_arrive_right.png',
  './icons/light/direction_arrive_right.png',
  './icons/dark/direction_continue_straight.png',
  './icons/light/direction_continue_straight.png',
  './icons/dark/direction_depart.png',
  './icons/light/direction_depart.png',
  './icons/dark/direction_depart_left.png',
  './icons/light/direction_depart_left.png',
  './icons/dark/direction_depart_right.png',
  './icons/light/direction_depart_right.png',
  './icons/dark/direction_fork_left.png',
  './icons/light/direction_fork_left.png',
  './icons/dark/direction_fork_right.png',
  './icons/light/direction_fork_right.png',
  './icons/dark/direction_fork_straight.png',
  './icons/light/direction_fork_straight.png',
  './icons/dark/direction_merge_left.png',
  './icons/light/direction_merge_left.png',
  './icons/dark/direction_merge_right.png',
  './icons/light/direction_merge_right.png',
  './icons/dark/direction_merge_straight.png',
  './icons/light/direction_merge_straight.png',
  './icons/dark/direction_new_name_straight.png',
  './icons/light/direction_new_name_straight.png',
  './icons/dark/direction_off_ramp_left.png',
  './icons/light/direction_off_ramp_left.png',
  './icons/dark/direction_off_ramp_right.png',
  './icons/light/direction_off_ramp_right.png',
  './icons/dark/direction_on_ramp_left.png',
  './icons/light/direction_on_ramp_left.png',
  './icons/dark/direction_on_ramp_right.png',
  './icons/light/direction_on_ramp_right.png',
  './icons/dark/direction_on_ramp_straight.png',
  './icons/light/direction_on_ramp_straight.png',
  './icons/dark/direction_roundabout.png',
  './icons/light/direction_roundabout.png',
  './icons/dark/direction_turn_left.png',
  './icons/light/direction_turn_left.png',
  './icons/dark/direction_turn_right.png',
  './icons/light/direction_turn_right.png',
  './icons/dark/direction_turn_sharp_left.png',
  './icons/light/direction_turn_sharp_left.png',
  './icons/dark/direction_turn_sharp_right.png',
  './icons/light/direction_turn_sharp_right.png',
  './icons/dark/direction_turn_slight_left.png',
  './icons/light/direction_turn_slight_left.png',
  './icons/dark/direction_turn_slight_right.png',
  './icons/light/direction_turn_slight_right.png',
  './icons/dark/direction_uturn.png',
  './icons/light/direction_uturn.png',
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
