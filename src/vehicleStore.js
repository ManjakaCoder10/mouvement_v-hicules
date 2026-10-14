'use strict';

/** Stockage en mémoire de la dernière position connue de chaque véhicule. */
class VehicleStore {
  constructor() {
    this.vehicles = new Map();
  }

  get size() {
    return this.vehicles.size;
  }

  /** Enregistre une position. Retourne la vue publique, ou null si elle est plus ancienne que la dernière. */
  upsert(pos, socketId) {
    const prev = this.vehicles.get(pos.vehicleId);
    if (prev && pos.timestamp < prev.timestamp) return null;

    const vehicle = { ...pos, online: true, socketId, receivedAt: Date.now() };
    this.vehicles.set(pos.vehicleId, vehicle);
    return this.toPublic(vehicle);
  }

  /** Marque un véhicule hors ligne, seulement si c'est bien la socket qui l'a enregistré. */
  markOffline(vehicleId, socketId) {
    const v = this.vehicles.get(vehicleId);
    if (!v || v.socketId !== socketId) return null;
    v.online = false;
    v.socketId = null;
    v.receivedAt = Date.now();
    return this.toPublic(v);
  }

  /** Supprime les véhicules hors ligne depuis plus de `maxOfflineMs`. Retourne les ID supprimés. */
  prune(maxOfflineMs) {
    const removed = [];
    const now = Date.now();
    for (const [id, v] of this.vehicles) {
      if (!v.online && now - v.receivedAt > maxOfflineMs) {
        this.vehicles.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  all() {
    return [...this.vehicles.values()].map((v) => this.toPublic(v));
  }

  toPublic(v) {
    const { socketId, receivedAt, ...rest } = v;
    return { ...rest, ageMs: Date.now() - receivedAt };
  }
}

module.exports = VehicleStore;
