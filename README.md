# Suivi de véhicules en temps réel

Node.js · Express · Socket.io · Leaflet

## Démarrage

```bash
npm install
npm start
```

- Conducteur : `http://localhost:3000/driver.html`
- Superviseur : `http://localhost:3000/dashboard.html`
- Passager : `http://localhost:3000/passenger.html` (lecture seule, sans jeton)

## Tester avec un vrai smartphone (HTTPS obligatoire)

Les navigateurs n'autorisent la géolocalisation que sur une origine sécurisée
(`https://` ou `localhost`). Pour tester depuis un téléphone, exposez le serveur en HTTPS :

```bash
npx cloudflared tunnel --url http://localhost:3000   # ou : ngrok http 3000
```

Ouvrez ensuite `https://<adresse-du-tunnel>/driver.html` sur le téléphone.
En production, placez le serveur derrière un reverse proxy HTTPS (Nginx, Caddy…)
qui transmet les WebSockets.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `PORT` | Port d'écoute (3000 par défaut) |
| `DRIVER_TOKEN` | Si défini, les conducteurs doivent ouvrir `/driver.html?token=…` |
| `SUPERVISOR_TOKEN` | Si défini, le tableau de bord s'ouvre avec `/dashboard.html?token=…` |
| `CORS_ORIGIN` | Origine autorisée si le front est hébergé ailleurs |

## Architecture

```
server.js              Express + Socket.io (namespaces /driver et /dashboard)
src/vehicleStore.js    Dernière position de chaque véhicule (mémoire)
src/validators.js      Validation des messages reçus
public/driver.*        Page conducteur (watchPosition, Wake Lock, file d'attente hors ligne)
public/dashboard.*     Carte Leaflet + liste de la flotte
public/passenger.*     Carte publique : uniquement les véhicules en circulation (namespace /passenger)
public/js/map-common.js  Carte, marqueurs animés et logique de flotte partagés
```

## Limites connues du navigateur

Une page web ne peut pas suivre la position de façon fiable en arrière-plan :
iOS Safari et Chrome Android suspendent la géolocalisation quand l'écran est verrouillé
ou l'onglet masqué. La Wake Lock API garde l'écran allumé, mais pour un suivi 100 % fiable
en arrière-plan il faut une application native (ou une PWA installée côté Android, avec des
garanties encore partielles).

## Fond de carte

Par défaut : tuiles OpenStreetMap (sans clé, usage raisonnable). Pour un rendu proche de Google Maps,
créez une clé gratuite sur https://dashboard.basemaps.carto.com et renseignez `CARTO_KEY` en haut de `public/js/map-common.js`.
