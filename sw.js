// Service Worker du Portail Roadbook VE
// - Met en cache l'app shell pour un fonctionnement hors-ligne
// - Intercepte les partages Android (Web Share Target API) et les redirige vers Roadbook VE
// - Cache dédié aux tuiles du fond de carte (cache-first, hors-ligne, voir plus bas)

const CACHE_NAME = 'roadbook-hub-v19';

// --- Cache des tuiles de carte ---------------------------------------------------
// TILE_CACHE doit rester identique à TILE_CACHE_NAME dans roadbook.html.
const TILE_CACHE = 'roadbook-tiles-v1';
// Même tuile quel que soit le sous-domaine (a./b./c.) : une seule entrée de cache.
const TILE_RE = /^https:\/\/(?:[a-c]\.)?tile\.openstreetmap\.de\/tiles\/osmde\/(\d{1,2})\/(\d+)\/(\d+)\.png$/;
const TILE_FETCH_TIMEOUT_MS = 8000;   // au-delà : on considère le réseau inutilisable
const TILE_CACHE_MAX_ENTRIES = 5000;  // ~100 Mo ; au-delà, les plus anciennes sont purgées
const TILE_OVERZOOM_MAX_STEPS = 4;    // agrandit une tuile parente jusqu'à 4 niveaux plus bas
let tileCorsSuspect = 0;              // échecs CORS suivis d'un succès no-cors
let tileCorsBroken = false;           // le serveur n'autorise pas CORS : on ne met plus rien en cache
let tilePutCounter = 0;

const APP_SHELL = [
  './',
  './index.html',
  './georouter.html',
  './roadbook.html',
  './manifest.json',
  './operateurs_principaux.csv',
  './autoroutes_payantes_surcouche.geojson',
  './icon-192.png',
  './icon-512.png',
  // Icônes de manœuvre GraphHopper (cf. GRAPHHOPPER_MANEUVER_ICON_FILES dans
  // roadbook.html) : seul le sous-ensemble réellement utilisé est mis en cache.
  './icons/dark/direction_arrive.png',
  './icons/light/direction_arrive.png',
  './icons/dark/direction_continue_straight.png',
  './icons/light/direction_continue_straight.png',
  './icons/dark/direction_depart.png',
  './icons/light/direction_depart.png',
  './icons/dark/direction_fork_left.png',
  './icons/light/direction_fork_left.png',
  './icons/dark/direction_fork_right.png',
  './icons/light/direction_fork_right.png',
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

const KEEP_CACHES = [CACHE_NAME, TILE_CACHE, 'incoming-shared-files'];

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
      Promise.all(keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k)))
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

  // --- Tuiles de carte : cache d'abord (économise le serveur OSM, fonctionne hors-ligne) ---
  if (event.request.method === 'GET') {
    const tile = parseTileUrl(url);
    if (tile) {
      // 'image' = affichage Leaflet (<img>) ; sinon = préchargement déclenché par la page (fetch()).
      // Le préchargement reçoit les erreurs brutes (pas de repli) pour pouvoir s'arrêter proprement.
      const isDisplay = event.request.destination === 'image';
      const p = handleTileRequest(event, tile, isDisplay);
      event.respondWith(isDisplay ? p.catch(() => fetch(event.request)) : p);
      return;
    }
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


// =====================================================================================
// TUILES DE CARTE
// =====================================================================================

function parseTileUrl(url) {
  const m = TILE_RE.exec(url.origin + url.pathname);
  return m ? { z: +m[1], x: +m[2], y: +m[3] } : null;
}

function tileKey(z, x, y) {
  return `https://tile.openstreetmap.de/tiles/osmde/${z}/${x}/${y}.png`;
}

async function fetchWithTimeout(input, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, Object.assign({}, init, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

// Récupère la tuile sur le réseau. On demande une réponse CORS (lisible, donc de taille réelle
// dans le quota) ; une réponse opaque (no-cors) n'est jamais mise en cache : Chrome la compte
// pour ~7 Mo dans le quota, quelques centaines de tuiles suffiraient à le saturer.
async function networkFetchTile(request, isDisplay) {
  if (!tileCorsBroken) {
    try {
      const resp = await fetchWithTimeout(request.url, { mode: 'cors', credentials: 'omit' }, TILE_FETCH_TIMEOUT_MS);
      tileCorsSuspect = 0;
      return { resp, cacheable: true };
    } catch (err) {
      // Préchargement ou délai dépassé : on ne retente pas (pas de requête en double vers le serveur).
      if (!isDisplay || err.name === 'AbortError') throw err;
      // Affichage : TypeError = hors-ligne OU CORS refusé. Un seul essai no-cors pour les départager.
    }
  }
  const resp = await fetchWithTimeout(request, {}, TILE_FETCH_TIMEOUT_MS); // lève si hors-ligne
  if (!tileCorsBroken && ++tileCorsSuspect >= 3) tileCorsBroken = true;
  return { resp, cacheable: false };
}

async function handleTileRequest(event, tile, isDisplay) {
  const request = event.request;
  const key = tileKey(tile.z, tile.x, tile.y);

  let cache = null;
  try {
    cache = await caches.open(TILE_CACHE);
    const hit = await cache.match(key, { ignoreVary: true });
    if (hit) return hit;
  } catch (e) { /* cache indisponible : on passe par le réseau */ }

  try {
    const { resp, cacheable } = await networkFetchTile(request, isDisplay);

    if (cacheable && resp.status === 200 && cache) {
      try {
        // await volontaire : la page de préchargement vérifie ensuite que la tuile est bien stockée
        await cache.put(key, resp.clone());
        scheduleTileTrim(event);
      } catch (e) { /* quota dépassé ou en-tête Vary: * : la tuile s'affiche, sans être mise en cache */ }
      return resp;
    }

    // Serveur qui limite / en erreur : à l'affichage, on préfère une tuile parente agrandie
    if (isDisplay && cache && (resp.status >= 500 || resp.status === 429 || resp.status === 403)) {
      const fb = await buildTileFromParent(cache, tile);
      if (fb) return fb;
    }
    return resp;
  } catch (err) {
    if (!isDisplay) throw err;
    // Hors-ligne (ou réseau trop lent) : tuile parente agrandie si on en a une, sinon tuile vide
    try {
      if (cache) {
        const fb = await buildTileFromParent(cache, tile);
        if (fb) return fb;
      }
    } catch (e) { /* ignore */ }
    return new Response('', { status: 504, statusText: 'Tuile indisponible hors-ligne' });
  }
}

// Fabrique une tuile en agrandissant la portion correspondante d'une tuile de zoom inférieur
// déjà en cache (flou mais lisible, bien mieux qu'un trou gris). Jamais mise en cache.
async function buildTileFromParent(cache, tile) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  for (let dz = 1; dz <= TILE_OVERZOOM_MAX_STEPS && tile.z - dz >= 0; dz++) {
    const px = Math.floor(tile.x / Math.pow(2, dz));
    const py = Math.floor(tile.y / Math.pow(2, dz));
    const parent = await cache.match(tileKey(tile.z - dz, px, py), { ignoreVary: true });
    if (!parent) continue;
    const bmp = await createImageBitmap(await parent.blob());
    const sub = bmp.width / Math.pow(2, dz);
    const sx = (tile.x - px * Math.pow(2, dz)) * sub;
    const sy = (tile.y - py * Math.pow(2, dz)) * sub;
    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, sx, sy, sub, sub, 0, 0, 256, 256);
    if (bmp.close) bmp.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Response(blob, { headers: { 'Content-Type': 'image/png', 'X-Tile-Overzoom': String(dz) } });
  }
  return null;
}

function scheduleTileTrim(event) {
  if (++tilePutCounter % 100 !== 0) return;
  event.waitUntil(trimTileCache());
}

async function trimTileCache() {
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    if (keys.length <= TILE_CACHE_MAX_ENTRIES) return;
    const excess = keys.length - Math.floor(TILE_CACHE_MAX_ENTRIES * 0.9);
    await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
  } catch (e) { /* purge best-effort */ }
}
