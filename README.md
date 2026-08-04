# Portail Roadbook VE — GeoRouter + Roadbook VE

Architecture "Hub & Spoke" : un portail central (`index.html`) qui aiguille vers deux
applications indépendantes, connectées entre elles via `localStorage`.

```
                  ┌────────────────────────┐
                  │   index.html (Hub)     │
                  └───────────┬────────────┘
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
   ┌───────────────────┐             ┌───────────────────┐
   │  georouter.html    │ ──(JSON)──> │  roadbook.html     │
   └───────────────────┘             └───────────────────┘
```

## Fichiers du dépôt

| Fichier                          | Rôle                                                                 |
|-----------------------------------|-----------------------------------------------------------------------|
| `index.html`                     | Page d'accueil / aiguilleur                                          |
| `georouter.html`                 | Calcul d'itinéraire (Valhalla / Stadia Maps) + péages                |
| `roadbook.html`                  | Suivi live du trajet + bornes de recharge IRVE/Qualicharge           |
| `topojson-client.min.js`         | Librairie utilisée par GeoRouter pour la surcouche péages            |
| `autoroutes_payantes.topojson`   | Données géographiques des tronçons d'autoroutes payantes             |
| `manifest.json`                  | Manifeste PWA (icônes, partage Android, etc.)                        |
| `sw.js`                          | Service Worker : cache hors-ligne + réception des partages Android   |
| `icon-192.png`, `icon-512.png`   | Icônes de l'application (à remplacer par votre propre logo si besoin)|

## Comment ça communique

Les deux applications sont totalement indépendantes (aucune ne connaît l'existence
de l'autre dans son code métier). Le pont se fait uniquement via une clé
`localStorage` commune : `current_route_data`.

```json
{
  "type": "json",
  "filename": "itineraire.json",
  "content": "{...json Valhalla ou texte GPX...}",
  "source": "georouter | hub-import",
  "ts": 1234567890
}
```

- **GeoRouter** : le bouton *"🚀 Envoyer vers Roadbook VE"* écrit ce JSON dans
  `localStorage` puis redirige vers `roadbook.html`.
- **Hub** : le sélecteur de fichier *"Ouvrir un Roadbook existant"* lit le fichier
  choisi, l'écrit dans la même clé, puis redirige.
- **Roadbook VE** : au chargement, `checkIncomingRouteData()` lit la clé (si
  présente), l'efface immédiatement, puis charge la trace exactement comme un
  import de fichier classique.

Le partage de fichier natif Android (bouton "Partager" → app) reste géré séparément
via le Service Worker (`share_target` dans `manifest.json` + cache
`incoming-shared-files`), sans passer par `localStorage`.

## Déploiement sur GitHub Pages

1. Créez un dépôt GitHub (public) et poussez-y **tous les fichiers ci-dessus, à la
   racine** (pas de sous-dossier).
2. Dans les paramètres du dépôt → **Pages**, choisissez la branche `main` et le
   dossier `/ (root)`.
3. Votre portail sera accessible à `https://<votre-utilisateur>.github.io/<votre-repo>/`.
4. Vérifiez que l'URL se termine par `index.html` ou juste `/` — les liens internes
   sont tous en chemins relatifs (`./georouter.html`, `./roadbook.html`, etc.), donc
   cela fonctionne quel que soit le nom du dépôt.

### Remarques

- La clé API Stadia Maps utilisée par GeoRouter est visible côté client (normal pour
  une app 100 % statique) — pensez à la restreindre par domaine référent dans votre
  tableau de bord Stadia Maps une fois le site en ligne.
- Le Service Worker met en cache l'app shell pour un usage hors-ligne ; si vous
  modifiez un fichier, incrémentez `CACHE_NAME` dans `sw.js` (ex: `roadbook-hub-v2`)
  pour forcer le rafraîchissement du cache chez les utilisateurs.
- `roadbook.html` télécharge la base IRVE (data.gouv.fr) et la stocke dans
  IndexedDB côté navigateur : aucun backend n'est nécessaire.
