/* Carte et marqueurs partagés par les pages Superviseur et Passager. */
window.TrackerMap = (() => {
  'use strict';

  const STALE_MS = 30000; // sans nouvelle position depuis 30 s : signal perdu
  const rad = Math.PI / 180;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAR = '<svg viewBox="0 0 44 44"><rect x="13" y="5" width="18" height="34" rx="8" fill="currentColor" stroke="#fff" stroke-width="2.5"/><path d="M16.5 16h11l-1.5-6h-8z" fill="#fff" opacity=".9"/><rect x="16" y="29" width="12" height="5" rx="2" fill="#fff" opacity=".6"/></svg>';

  // Clé CARTO gratuite (https://dashboard.basemaps.carto.com) : si renseignée, fond « Voyager » proche de Google Maps.
  // Sinon, tuiles OpenStreetMap (sans clé).
  const CARTO_KEY = '';

  function createMap(el) {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const map = L.map(el, { zoomControl: false }).setView([46.6, 2.4], 6);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const carto = `https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'rastertiles/voyager'}/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`;
    L.tileLayer(CARTO_KEY ? carto : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      subdomains: 'abcd', maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' + (CARTO_KEY ? ' &copy; <a href="https://carto.com/attributions">CARTO</a>' : ''),
    }).addTo(map);
    if (!CARTO_KEY && dark) el.classList.add('map--invert'); // mode sombre sur les tuiles OSM
    return map;
  }

  function bearing(a, b) {
    const dl = (b.lng - a.lng) * rad;
    const y = Math.sin(dl) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dl);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  /** Bouton « ma position » avec le point bleu pulsant à la Google Maps. */
  function locate(map, btn) {
    let dot = null;
    map.on('locationfound', (ev) => {
      btn.classList.remove('fab--err');
      if (dot) dot.setLatLng(ev.latlng);
      else dot = L.marker(ev.latlng, { interactive: false, icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }) }).addTo(map);
    });
    map.on('locationerror', () => btn.classList.add('fab--err'));
    btn.addEventListener('click', () => map.locate({ setView: true, maxZoom: 16 }));
  }

  /** Ensemble de véhicules sur la carte. opts : tags, trail, liveOnly, popup(e), onSelect(id), onTick(). */
  class Fleet {
    constructor(map, opts = {}) {
      this.map = map;
      this.o = opts;
      this.items = new Map(); // id -> { data, seenAt, rot, marker, trail }
      setInterval(() => { this.items.forEach((e) => this.refresh(e)); if (opts.onTick) opts.onTick(); }, 1000);
    }

    status(e) { return !e.data.online ? 'offline' : Date.now() - e.seenAt > STALE_MS ? 'stale' : 'live'; }

    liveCount() { let n = 0; this.items.forEach((e) => { if (this.status(e) === 'live') n++; }); return n; }

    upsert(d) {
      const ll = L.latLng(d.lat, d.lng);
      const seenAt = Date.now() - (d.ageMs || 0);
      let e = this.items.get(d.vehicleId);

      if (!e) {
        e = { data: d, seenAt, rot: d.heading || 0 };
        const tag = this.o.tags ? `<span class="veh__tag">${esc(d.vehicleId)}</span>` : '';
        e.marker = L.marker(ll, {
          keyboard: false,
          icon: L.divIcon({ className: 'veh-wrap', iconSize: [44, 44], iconAnchor: [22, 22], html: `<div class="veh"><span class="veh__pulse"></span><span class="veh__car">${CAR}</span>${tag}</div>` }),
        });
        if (this.o.popup) e.marker.bindPopup(() => this.o.popup(e));
        if (this.o.onSelect) e.marker.on('click', () => this.o.onSelect(d.vehicleId));
        if (this.o.trail) e.trail = L.polyline([ll], { color: '#1a73e8', weight: 5, opacity: 0.8, lineCap: 'round' });
        this.items.set(d.vehicleId, e);
      } else {
        const from = e.marker.getLatLng();
        let h = d.heading;
        if (h == null && this.map.distance(from, ll) > 3) h = bearing(from, ll); // cap déduit du déplacement
        if (h != null) e.rot += ((((h - e.rot) % 360) + 540) % 360) - 180;       // rotation par le chemin le plus court
        e.data = d;
        e.seenAt = seenAt;
        e.marker.setLatLng(ll);
        if (e.trail) {
          e.trail.addLatLng(ll);
          const pts = e.trail.getLatLngs();
          if (pts.length > 200) e.trail.setLatLngs(pts.slice(-200));
        }
      }
      this.refresh(e);
      if (this.o.popup && e.marker.isPopupOpen()) e.marker.setPopupContent(this.o.popup(e));
    }

    refresh(e) {
      const s = this.status(e);
      const show = !this.o.liveOnly || s === 'live';
      const on = this.map.hasLayer(e.marker);
      if (show && !on) { e.marker.addTo(this.map); if (e.trail) e.trail.addTo(this.map); }
      else if (!show && on) { e.marker.remove(); if (e.trail) e.trail.remove(); }
      const el = e.marker.getElement();
      if (el) {
        const v = el.firstChild;
        v.className = `veh veh--${s}`;
        v.querySelector('.veh__car').style.transform = `rotate(${e.rot}deg)`;
      }
    }

    remove(id) {
      const e = this.items.get(id);
      if (!e) return;
      e.marker.remove();
      if (e.trail) e.trail.remove();
      this.items.delete(id);
    }

    clear() { [...this.items.keys()].forEach((id) => this.remove(id)); }

    fit(maxZoom = 16) {
      const pts = [...this.items.values()].filter((e) => this.map.hasLayer(e.marker)).map((e) => e.marker.getLatLng());
      if (pts.length) this.map.fitBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom });
    }

    focus(id) {
      const e = this.items.get(id);
      if (!e) return;
      this.map.flyTo(e.marker.getLatLng(), Math.max(this.map.getZoom(), 16), { duration: 0.9 });
      if (this.o.popup) e.marker.openPopup();
    }
  }

  return { createMap, locate, Fleet, esc };
})();
