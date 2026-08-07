# ⚡ LaWatture

Préparez et suivez vos trajets en véhicule électrique — calcul d'itinéraire avec coût des péages, puis suivi live avec bornes de recharge sur la route.

Application 100 % statique (HTML/CSS/JS, aucun backend), installable en PWA sur mobile.

---

## Architecture — Hub & Spoke

Un portail central aiguille vers deux applications indépendantes, connectées entre elles via `localStorage` :

```
                    ┌─────────────────────┐
                    │   index.html (Hub)  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                  ▼
   ┌──────────────────────┐           ┌──────────────────────┐
   │   georouter.html      │  ──JSON──▶│   roadbook.html       │
   │   Calcul d'itinéraire │           │   Suivi live du trajet│
   └──────────────────────┘           └──────────────────────┘
```

Les deux applications ne se connaissent pas dans leur code métier : le pont se fait uniquement via une clé `localStorage` commune (`current_route_data`), qui transporte soit un JSON Valhalla, soit un GPX brut.

---

## Les trois pages

### 🏠 `index.html` — Portail
Point d'entrée : importer une trace existante (GPX / JSON Valhalla, fichier ou partage Android), tracer un nouvel itinéraire, ou ouvrir directement le suivi.

### 🗺️ `georouter.html` — Calcul d'itinéraire
- Calcul via [Valhalla](https://valhalla.github.io/valhalla/) (API Stadia Maps), autocomplete d'adresses (Photon / Base Adresse Nationale)
- Étapes intermédiaires réordonnables par glisser-déposer
- **Coût des péages calculé par matching géométrique** entre le tracé et une surcouche BD Carto (voir *Pipeline péages* ci-dessous) — pas d'estimation au forfait, chaque tronçon réellement emprunté est sommé
- Export GPX / JSON, envoi direct vers Roadbook VE
- Interface en bottom sheet à 3 hauteurs (basse / milieu / haute), la carte se redimensionne en miroir

### ⚡ `roadbook.html` — Roadbook VE
- Suivi de position en direct sur la trace chargée (géolocalisation, mode simulation pour tester sans conduire)
- Deux vues : **feuille de route** (instructions de conduite à venir, avec code couleur selon la distance) et **bornes de recharge** (Qualicharge en direct, filtrable par opérateur, détail des points de charge)
- Fonctionne hors-ligne une fois la trace chargée (cache Service Worker + IndexedDB pour la base de communes)
- Réception de trace via `localStorage` (depuis GeoRouter/le portail) ou partage natif Android (Web Share Target)

---

## Design system

Les trois pages partagent un même langage visuel :

| | Clair | Sombre |
|---|---|---|
| Fond | `#FFFFFF` | `#0B0B0E` |
| Accent | `#0B72E7` | `#4FA3FF` |

- **Typographie** : Space Grotesk (titres, chiffres clés) + Inter (texte courant) + JetBrains Mono (logs, données tabulaires)
- **Thème** automatique selon les préférences système (`prefers-color-scheme`), pas de bouton manuel
- **Bottom sheet** à 3 positions (basse / milieu / haute) sur GeoRouter et Roadbook VE, glissable et cohérent entre les deux pages
- Logo : pin de navigation + éclair, cohérent sur le filigrane du portail et les icônes PWA

---

## 🗺️ Pipeline de données — coût des péages

La surcouche `autoroutes_payantes_surcouche.geojson` (chargée par GeoRouter) est générée en amont, hors application, à partir de [BD Carto (IGN)](https://geoservices.ign.fr/bdcarto) :

```bash
python3 generate_surcouche_geojson.py
```

Le script :
1. Extrait de BD Carto uniquement les tronçons autoroutiers marqués payants (`acces_vehicule_leger LIKE '%péage%'`)
2. Injecte sur **chaque tronçon** un coût déjà calculé en euros (tarif au km × longueur du tronçon, tarif lu dans un CSV de référence par autoroute)
3. Exporte un GeoJSON léger (`numero`, `gestionnaire`, `cout_troncon_eur`) — **aucun tarif au km n'est exposé dans le fichier final**, le coût est figé à la génération

Côté app, GeoRouter fait un **matching géométrique** (Turf.js) entre le tracé calculé et les tronçons de cette surcouche : chaque tronçon distinct traversé est compté une fois, et son `cout_troncon_eur` est additionné. Pas de recalcul, pas d'approximation au kilomètre parcouru.

> Le CSV de tarifs par autoroute (source du calcul du script) n'est pas versionné dans ce dépôt — à maintenir séparément.

---

## Stack technique

- **Cartographie** : [Leaflet](https://leafletjs.com/)
- **Itinéraire** : Valhalla via [Stadia Maps](https://stadiamaps.com/)
- **Géocodage** : [Photon](https://photon.komoot.io/) / [Base Adresse Nationale](https://adresse.data.gouv.fr/)
- **Matching géométrique péages** : [Turf.js](https://turfjs.org/)
- **Bornes de recharge** : [Qualicharge](https://www.data.gouv.fr/dataservices/api-qualicharge/) (données en direct)
- **Stockage local** : IndexedDB (cache communes), `localStorage` (transfert de trace entre pages)
- **PWA** : Service Worker (cache hors-ligne + réception de partage Android), Web App Manifest

Aucune dépendance de build : chaque page est un fichier HTML autonome, à héberger tel quel (GitHub Pages, ou tout hébergement statique).

---

## Structure du dépôt

```
index.html                              Portail
georouter.html                          Calcul d'itinéraire
roadbook.html                           Suivi live
manifest.json                           Manifeste PWA
sw.js                                   Service Worker
icon-192.png / icon-512.png             Icônes PWA
autoroutes_payantes_surcouche.geojson   Surcouche péages (généré, cf. pipeline)
icons/dark/ , icons/light/              Pictogrammes de manœuvre (Roadbook)
generate_surcouche_geojson.py           Script de génération de la surcouche péages
```

---

## Déploiement (GitHub Pages)

1. Poussez tous les fichiers ci-dessus **à la racine** du dépôt (pas de sous-dossier, sauf `icons/`)
2. Paramètres du dépôt → **Pages** → branche `main`, dossier `/ (root)`
3. Le site est servi à `https://<utilisateur>.github.io/<repo>/` — tous les liens internes sont en chemins relatifs, donc indépendants du nom du dépôt

### À savoir
- La clé API Stadia Maps utilisée par GeoRouter est visible côté client (normal pour une app 100 % statique) — pensez à la restreindre par domaine référent dans votre tableau de bord Stadia Maps
- Si vous modifiez un fichier, incrémentez `CACHE_NAME` dans `sw.js` pour forcer le rafraîchissement du cache chez les utilisateurs déjà installés
- `roadbook.html` télécharge la base des communes (pour le géocodage inverse) et la stocke en IndexedDB au premier lancement

---

## Limitations connues

- Le coût des péages est une estimation basée sur un tarif moyen par autoroute (pas de granularité par gare de péage individuelle)
- Les autoroutes en flux libre (sans barrière physique) dépendent du bon étiquetage `péage` dans BD Carto en amont
- Pas de backend : toute donnée sensible (clé API) est visible côté client
