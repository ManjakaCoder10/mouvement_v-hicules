(() => {
  'use strict';

  const token = new URLSearchParams(location.search).get('token') || undefined;
  const $ = (id) => document.getElementById(id);
  const ui = { list: $('list'), empty: $('empty'), summary: $('summary'), conn: $('connBadge'), search: $('search'), sheet: $('sheet') };
  const { esc } = TrackerMap;

  const map = TrackerMap.createMap('map');
  const rows = new Map(); // id -> { li, btn } (les lignes sont mises à jour, pas recréées)
  let selectedId = null;
  let firstView = false;
  let query = '';

  function ageText(e) {
    const s = Math.max(0, Math.round((Date.now() - e.seenAt) / 1000));
    if (!e.data.online) return s < 60 ? `Déconnecté il y a ${s} s` : `Déconnecté il y a ${Math.round(s / 60)} min`;
    if (s < 5) return 'À l\u2019instant';
    if (s < 60) return `Il y a ${s} s`;
    if (s < 3600) return `Il y a ${Math.round(s / 60)} min`;
    return `Il y a ${Math.round(s / 3600)} h`;
  }
  const speedText = (d) => (d.speedKmh != null ? `${d.speedKmh} km/h` : '— km/h');

  function popupHtml(e) {
    const d = e.data;
    return `<div class="popup"><b>${esc(d.vehicleId)}</b><br><span>Vitesse</span> ${esc(speedText(d))}<br>` +
      `<span>Précision</span> ${d.accuracy != null ? '± ' + d.accuracy + ' m' : '—'}<br>` +
      `<span>Mesure</span> ${new Date(d.timestamp).toLocaleTimeString('fr-FR')}<br>${esc(ageText(e))}</div>`;
  }

  const fleet = new TrackerMap.Fleet(map, {
    tags: true, trail: true, popup: popupHtml,
    onSelect: (id) => { selectedId = id; renderList(); },
    onTick: renderList,
  });

  function renderList() {
    const q = query.trim().toLowerCase();
    const entries = [...fleet.items].filter(([id]) => id.toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true }));
    const keep = new Set();

    entries.forEach(([id, e], i) => {
      keep.add(id);
      let r = rows.get(id);
      if (!r) {
        r = { li: document.createElement('li'), btn: document.createElement('button') };
        r.btn.type = 'button';
        r.btn.innerHTML = '<span class="dot"></span><span class="id"></span><span class="spd"></span><span class="age"></span>';
        r.btn.addEventListener('click', () => { selectedId = id; fleet.focus(id); renderList(); });
        r.li.append(r.btn);
        rows.set(id, r);
      }
      const [, name, spd, age] = r.btn.children;
      r.btn.dataset.status = fleet.status(e);
      if (id === selectedId) r.btn.setAttribute('aria-current', 'true'); else r.btn.removeAttribute('aria-current');
      name.textContent = id;
      spd.textContent = speedText(e.data);
      age.textContent = ageText(e);
      if (ui.list.children[i] !== r.li) ui.list.insertBefore(r.li, ui.list.children[i] || null);
    });
    rows.forEach((r, id) => { if (!keep.has(id)) { r.li.remove(); if (!fleet.items.has(id)) rows.delete(id); } });

    const n = fleet.items.size;
    ui.empty.hidden = n > 0;
    ui.summary.textContent = n === 0 ? 'Aucun véhicule' : `${fleet.liveCount()} en ligne sur ${n} véhicule${n > 1 ? 's' : ''}`;
  }

  function upsert(d) {
    fleet.upsert(d);
    if (!firstView) { map.setView([d.lat, d.lng], 15); firstView = true; }
    renderList();
  }

  $('fitBtn').addEventListener('click', () => fleet.fit());
  TrackerMap.locate(map, $('meBtn'));
  ui.search.addEventListener('input', () => { query = ui.search.value; renderList(); });
  $('handle').addEventListener('click', () => ui.sheet.classList.toggle('collapsed'));

  /* ---------- Socket.io ---------- */

  const setConn = (state, text) => { ui.conn.dataset.state = state; ui.conn.textContent = text; };
  // eslint-disable-next-line no-undef
  const socket = io('/dashboard', { auth: { token }, reconnectionDelayMax: 5000 });

  socket.on('connect', () => setConn('on', 'Temps réel'));
  socket.on('disconnect', () => setConn('warn', 'Reconnexion…'));
  socket.on('connect_error', (err) => setConn(err.message === 'unauthorized' ? 'err' : 'warn', err.message === 'unauthorized' ? 'Jeton invalide' : 'Reconnexion…'));

  socket.on('vehicles:snapshot', (list) => {
    fleet.clear(); // repart d'un état propre après reconnexion
    list.forEach(upsert);
    if (list.length) fleet.fit();
    renderList();
  });
  socket.on('vehicle:update', upsert);
  socket.on('vehicle:offline', upsert);
  socket.on('vehicle:removed', (id) => { fleet.remove(id); renderList(); });
})();
