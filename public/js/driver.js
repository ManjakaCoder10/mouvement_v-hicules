(() => {
  'use strict';

  const SEND_INTERVAL_MS = 1000;   // 1 position / seconde maximum
  const MAX_QUEUE = 500;           // positions conservées pendant une coupure réseau
  const GPS_SILENCE_MS = 20000;    // alerte si aucun signal GPS pendant 20 s
  const BACKGROUND_WARN_S = 5;
  const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
  const STORAGE_KEY = 'tracker.vehicleId';

  const $ = (id) => document.getElementById(id);
  const ui = {
    setup: $('setup'), live: $('live'), vehicleId: $('vehicleId'), start: $('startBtn'), stop: $('stopBtn'),
    conn: $('connBadge'), speed: $('speed'), vid: $('vid'), gps: $('gps'), acc: $('acc'),
    sent: $('sent'), wake: $('wake'), queued: $('queued'), alert: $('alert'),
  };

  const token = new URLSearchParams(location.search).get('token') || undefined;

  let socket = null;
  let watchId = null;
  let wakeLock = null;
  let tracking = false;
  let lastSentAt = 0;
  let lastFixAt = 0;
  let hiddenAt = null;
  let alertSource = null;
  let watchdog = null;
  const queue = [];

  /* ---------- Interface ---------- */

  function setConn(state, text) {
    ui.conn.dataset.state = state;
    ui.conn.textContent = text;
  }

  function showAlert(message, kind = 'warn', source = 'misc') {
    ui.alert.textContent = message;
    ui.alert.dataset.kind = kind;
    ui.alert.hidden = false;
    alertSource = source;
  }

  function clearAlert(source) {
    if (source && alertSource !== source) return;
    ui.alert.hidden = true;
    alertSource = null;
  }

  const clock = (ts) => new Date(ts).toLocaleTimeString('fr-FR');
  const updateQueueUi = () => { ui.queued.textContent = String(queue.length); };

  /* ---------- Socket.io ---------- */

  function connect(vehicleId) {
    // eslint-disable-next-line no-undef
    socket = io('/driver', { auth: { vehicleId, token }, reconnectionDelayMax: 5000 });

    socket.on('connect', () => {
      setConn('on', 'Connecté');
      clearAlert('net');
      flushQueue();
    });
    socket.on('disconnect', () => {
      setConn('warn', 'Reconnexion…');
      if (tracking) showAlert('Connexion au serveur perdue. Les positions sont mises en attente et seront envoyées au retour du réseau.', 'warn', 'net');
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized' || err.message === 'invalid_vehicle_id') {
        setConn('err', 'Refusé');
        showAlert(err.message === 'unauthorized' ? 'Accès refusé par le serveur (jeton manquant ou invalide).' : 'Identifiant de véhicule refusé par le serveur.', 'err', 'net');
        stop();
      } else {
        setConn('warn', 'Reconnexion…');
      }
    });
  }

  function send(payload) {
    if (socket && socket.connected) {
      socket.emit('position', payload, (res) => { if (res && res.ok) ui.sent.textContent = clock(Date.now()); });
    } else {
      queue.push(payload);
      if (queue.length > MAX_QUEUE) queue.shift();
      updateQueueUi();
    }
  }

  function flushQueue() {
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    updateQueueUi();
    for (let i = 0; i < batch.length; i += 200) {
      socket.emit('positions', batch.slice(i, i + 200));
    }
  }

  /* ---------- Géolocalisation ---------- */

  function onPosition(pos) {
    const c = pos.coords;
    const now = Date.now();
    lastFixAt = now;
    clearAlert('gps');

    ui.gps.textContent = 'Actif';
    ui.acc.textContent = c.accuracy != null ? `± ${Math.round(c.accuracy)} m` : '—';
    ui.speed.textContent = c.speed != null && c.speed >= 0 ? String(Math.round(c.speed * 3.6)) : '0';

    if (now - lastSentAt < SEND_INTERVAL_MS) return; // limite la fréquence d'envoi
    lastSentAt = now;

    send({
      vehicleId: ui.vehicleId.value.trim(),
      lat: c.latitude,
      lng: c.longitude,
      speed: c.speed,          // m/s ou null
      heading: c.heading,      // degrés ou null
      accuracy: c.accuracy,
      timestamp: pos.timestamp,
    });
  }

  function onGeoError(err) {
    if (err.code === err.PERMISSION_DENIED) {
      showAlert('Localisation refusée. Autorisez-la dans les réglages du navigateur, puis relancez le suivi.', 'err', 'gps');
      stop();
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      ui.gps.textContent = 'Indisponible';
      showAlert('Position indisponible. Vérifiez que le GPS est activé et que vous avez une vue dégagée.', 'warn', 'gps');
    } else {
      ui.gps.textContent = 'Délai dépassé';
    }
  }

  /* ---------- Maintien actif ---------- */

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      ui.wake.textContent = 'Non supporté';
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      ui.wake.textContent = 'Oui';
      wakeLock.addEventListener('release', () => { if (tracking) ui.wake.textContent = 'Non'; });
    } catch (e) {
      ui.wake.textContent = 'Refusé';
    }
  }

  // Le verrou est libéré automatiquement quand la page est masquée : on le redemande au retour.
  document.addEventListener('visibilitychange', () => {
    if (!tracking) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    if (hiddenAt) {
      const seconds = Math.round((Date.now() - hiddenAt) / 1000);
      hiddenAt = null;
      if (seconds >= BACKGROUND_WARN_S) {
        showAlert(`L'application est restée en arrière-plan ${seconds} s : des positions ont pu être perdues. Gardez cet écran au premier plan.`, 'warn', 'bg');
      }
    }
    requestWakeLock();
  });

  // Demande confirmation si le conducteur tente de fermer ou recharger l'onglet.
  function beforeUnloadGuard(e) {
    e.preventDefault();
    e.returnValue = ''; // requis par certains navigateurs pour afficher la confirmation
  }

  function startWatchdog() {
    watchdog = setInterval(() => {
      if (!tracking || !lastFixAt) return;
      const silence = Date.now() - lastFixAt;
      if (silence > GPS_SILENCE_MS) {
        ui.gps.textContent = 'Signal perdu';
        showAlert(`Aucun signal GPS depuis ${Math.round(silence / 1000)} s. Vérifiez que la page est visible et que le GPS est activé.`, 'warn', 'gps');
      }
    }, 5000);
  }

  /* ---------- Démarrage / arrêt ---------- */

  function start() {
    const vehicleId = ui.vehicleId.value.trim();
    if (!ID_RE.test(vehicleId)) {
      showAlert('Identifiant invalide : utilisez 1 à 32 caractères (lettres, chiffres, tiret ou underscore).', 'err', 'form');
      return;
    }
    if (!('geolocation' in navigator)) {
      showAlert("Ce navigateur ne propose pas la géolocalisation.", 'err', 'form');
      return;
    }
    if (!window.isSecureContext) {
      showAlert("La géolocalisation exige une connexion HTTPS. Ouvrez cette page via une adresse https://.", 'err', 'form');
      return;
    }

    try { localStorage.setItem(STORAGE_KEY, vehicleId); } catch (_) { /* stockage indisponible */ }
    clearAlert();

    tracking = true;
    lastFixAt = Date.now();
    ui.vid.textContent = vehicleId;
    ui.gps.textContent = 'En attente…';
    ui.setup.hidden = true;
    ui.live.hidden = false;
    setConn('warn', 'Connexion…');

    connect(vehicleId);
    watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });
    requestWakeLock();
    startWatchdog();
    window.addEventListener('beforeunload', beforeUnloadGuard);
  }

  function stop() {
    tracking = false;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearInterval(watchdog);
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
    if (socket) socket.disconnect();
    socket = null;
    queue.length = 0;
    updateQueueUi();
    window.removeEventListener('beforeunload', beforeUnloadGuard);

    setConn('off', 'Hors ligne');
    ui.live.hidden = true;
    ui.setup.hidden = false;
  }

  ui.start.addEventListener('click', start);
  ui.stop.addEventListener('click', stop);
  ui.vehicleId.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

  try { ui.vehicleId.value = localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { /* ignore */ }
})();
