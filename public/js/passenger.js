(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const { esc } = TrackerMap;
  const map = TrackerMap.createMap('map');
  let fitted = false;

  const fleet = new TrackerMap.Fleet(map, {
    liveOnly: true, // le passager ne voit que les véhicules actuellement en circulation
    popup: (e) => `<div class="popup"><b>${esc(e.data.vehicleId)}</b><br><span>En circulation</span></div>`,
    onTick: render,
  });

  function render() {
    const n = fleet.liveCount();
    $('count').textContent = n === 0 ? 'Aucun véhicule pour le moment' : `${n} véhicule${n > 1 ? 's' : ''} en ligne`;
    $('empty').hidden = n > 0;
  }

  function upsert(d) {
    fleet.upsert(d);
    if (!fitted) { fleet.fit(); fitted = true; }
    render();
  }

  $('fitBtn').addEventListener('click', () => fleet.fit());
  TrackerMap.locate(map, $('meBtn'));

  const conn = $('connBadge');
  const setConn = (state, text) => { conn.dataset.state = state; conn.textContent = text; };
  // eslint-disable-next-line no-undef
  const socket = io('/passenger', { reconnectionDelayMax: 5000 });

  socket.on('connect', () => setConn('on', 'Direct'));
  socket.on('disconnect', () => setConn('warn', 'Reconnexion…'));
  socket.on('connect_error', () => setConn('warn', 'Reconnexion…'));
  socket.on('vehicles:snapshot', (list) => { fleet.clear(); fitted = false; list.forEach(upsert); render(); });
  socket.on('vehicle:update', upsert);
  socket.on('vehicle:removed', (id) => { fleet.remove(id); render(); });
})();
