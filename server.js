'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const VehicleStore = require('./src/vehicleStore');
const { isValidVehicleId, parsePosition } = require('./src/validators');

const PORT = Number(process.env.PORT) || 3000;
const DRIVER_TOKEN = process.env.DRIVER_TOKEN || '';         // optionnel
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || ''; // optionnel
const PRUNE_AFTER_MS = 60 * 60 * 1000; // oublie un véhicule hors ligne depuis 1 h
const MAX_BATCH = 200;
const MAX_EVENTS_PER_SEC = 20;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10_000,
  pingTimeout: 10_000,
  cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN } : undefined,
});
const store = new VehicleStore();

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] })); // /passenger, /driver, /dashboard
app.get('/health', (_req, res) => res.json({ status: 'ok', vehicles: store.size }));

const drivers = io.of('/driver');
const dashboards = io.of('/dashboard');
const passengers = io.of('/passenger');

// Vue publique : uniquement ce qu'un passager a besoin de voir (pas de vitesse ni de précision).
const toPassenger = (v) => ({ vehicleId: v.vehicleId, lat: v.lat, lng: v.lng, heading: v.heading, timestamp: v.timestamp });

function createLimiter(maxPerSecond) {
  let windowStart = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart >= 1000) { windowStart = now; count = 0; }
    return ++count <= maxPerSecond;
  };
}

/* ---------- Namespace /driver : émetteurs de position ---------- */

drivers.use((socket, next) => {
  const { vehicleId, token } = socket.handshake.auth || {};
  if (DRIVER_TOKEN && token !== DRIVER_TOKEN) return next(new Error('unauthorized'));
  if (!isValidVehicleId(vehicleId)) return next(new Error('invalid_vehicle_id'));
  socket.data.vehicleId = vehicleId;
  next();
});

drivers.on('connection', (socket) => {
  const { vehicleId } = socket.data;
  const allow = createLimiter(MAX_EVENTS_PER_SEC);
  console.log(`[driver] ${vehicleId} connecté (${socket.id})`);

  function ingest(list) {
    let accepted = 0;
    for (const raw of list.slice(0, MAX_BATCH)) {
      if (!raw || raw.vehicleId !== vehicleId) continue; // empêche l'usurpation d'un autre ID
      const pos = parsePosition(raw);
      if (!pos) continue;
      const view = store.upsert(pos, socket.id);
      if (!view) continue;
      dashboards.emit('vehicle:update', view);
      passengers.emit('vehicle:update', toPassenger(view));
      accepted++;
    }
    return accepted;
  }

  // Position unique (cas normal)
  socket.on('position', (payload, ack) => {
    const ok = allow() && ingest([payload]) === 1;
    if (typeof ack === 'function') ack({ ok });
  });

  // Lot de positions (rattrapage après une coupure réseau)
  socket.on('positions', (payloads, ack) => {
    const accepted = allow() && Array.isArray(payloads) ? ingest(payloads) : 0;
    if (typeof ack === 'function') ack({ ok: true, accepted });
  });

  socket.on('disconnect', (reason) => {
    console.log(`[driver] ${vehicleId} déconnecté (${reason})`);
    const view = store.markOffline(vehicleId, socket.id);
    if (view) {
      dashboards.emit('vehicle:offline', view);
      passengers.emit('vehicle:removed', vehicleId); // hors ligne = n'apparaît plus chez les passagers
    }
  });
});

/* ---------- Namespace /dashboard : superviseurs ---------- */

dashboards.use((socket, next) => {
  const { token } = socket.handshake.auth || {};
  if (SUPERVISOR_TOKEN && token !== SUPERVISOR_TOKEN) return next(new Error('unauthorized'));
  next();
});

dashboards.on('connection', (socket) => {
  socket.emit('vehicles:snapshot', store.all()); // état courant dès la connexion
});

/* ---------- Namespace /passenger : lecture seule, public ---------- */

passengers.on('connection', (socket) => {
  socket.emit('vehicles:snapshot', store.all().filter((v) => v.online).map(toPassenger));
});

/* ---------- Maintenance ---------- */

setInterval(() => {
  for (const id of store.prune(PRUNE_AFTER_MS)) dashboards.emit('vehicle:removed', id);
}, 60_000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur démarré : http://localhost:${PORT}`);
  console.log(`  Conducteur  : http://localhost:${PORT}/driver.html`);
  console.log(`  Superviseur : http://localhost:${PORT}/dashboard.html`);
  console.log(`  Passager    : http://localhost:${PORT}/passenger.html`);
});

function shutdown() {
  console.log('Arrêt du serveur…');
  io.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
