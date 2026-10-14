'use strict';

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function isValidVehicleId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/**
 * Valide et normalise une position reçue d'un conducteur.
 * Retourne null si le message est invalide.
 * `speed` est attendu en m/s (valeur brute de l'API Geolocation).
 */
function parsePosition(p) {
  if (!p || typeof p !== 'object') return null;
  if (!isValidVehicleId(p.vehicleId)) return null;
  if (!isNum(p.lat) || p.lat < -90 || p.lat > 90) return null;
  if (!isNum(p.lng) || p.lng < -180 || p.lng > 180) return null;

  const now = Date.now();
  let timestamp = isNum(p.timestamp) ? p.timestamp : now;
  if (timestamp > now + 60000) timestamp = now; // horloge du téléphone en avance

  return {
    vehicleId: p.vehicleId,
    lat: p.lat,
    lng: p.lng,
    speedKmh: isNum(p.speed) && p.speed >= 0 ? Math.round(p.speed * 3.6) : null,
    heading: isNum(p.heading) ? p.heading : null,
    accuracy: isNum(p.accuracy) ? Math.round(p.accuracy) : null,
    timestamp,
  };
}

module.exports = { isValidVehicleId, parsePosition };
