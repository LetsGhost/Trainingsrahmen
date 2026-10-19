// Zwei Zustandsautomaten:
//   Einrichtung: SETUP_HOTSPOT → SETUP_ACCOUNT → READY ⇄ OFFLINE
//   Ruhe:        AKTIV → SLIDESHOW → AUS; Bewegung oder Touch führt zurück zu AKTIV
// Die Ruhe-Fristen laufen nur in READY und OFFLINE; während der Einrichtung bleibt das Display an.
// Jede Änderung meldet "change" mit der vollständigen Momentaufnahme, der Server reicht sie per SSE weiter.
const { EventEmitter } = require("events");
const { FrameError } = require("./errors");

const SETUP = { HOTSPOT: "SETUP_HOTSPOT", ACCOUNT: "SETUP_ACCOUNT", READY: "READY", OFFLINE: "OFFLINE" };
const REST = { ACTIVE: "AKTIV", SLIDESHOW: "SLIDESHOW", OFF: "AUS" };

const MIN = 60 * 1000;
const HOTSPOT_RETRY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const NO_INTERNET = { code: "NO_INTERNET", message: "Kein Internet" };

const toError = err => ({ code: err.code ?? "UNKNOWN", message: err.message });

// Eingaben aus dem Portal prüfen und säubern.
function validate({ wifi, server } = {}) {
  const ssid = String(wifi?.ssid ?? "").trim();
  const url = String(server?.url ?? "").trim();
  const apiKey = String(server?.apiKey ?? "").trim();
  if (!ssid) throw new FrameError("INVALID", "WLAN fehlt");
  if (!/^https?:\/\/\S+$/i.test(url)) throw new FrameError("INVALID", "Server-URL muss mit http:// oder https:// beginnen");
  if (!apiKey) throw new FrameError("INVALID", "API-Key fehlt");
  return { wifi: { ssid, password: String(wifi.password ?? "") }, server: { url, apiKey } };
}

function createFrame({ system, backend, config, saveConfig, hasImages }) {
  const emitter = new EventEmitter();
  // connectingTo: WLAN-Name, solange nach dem Absenden verbunden wird.
  const s = { setup: null, rest: REST.ACTIVE, connecting: false, connectingTo: null, error: null, hotspot: null, cpuTemp: null };
  let restTimers = [];
  let retryTimer = null;
  let checkTimer = null;
  let checking = false;

  const operating = () => s.setup === SETUP.READY || s.setup === SETUP.OFFLINE;

  function snapshot() {
    return {
      ...s,
      portalUrl: operating() ? null : system.portalUrl(),
      deadlines: { slideshowAfterMin: config.slideshowAfterMin, offAfterMin: config.offAfterMin },
      system: system.status()
    };
  }

  const changed = () => emitter.emit("change", snapshot());

  // --- Ruhe ---

  // Gibt zurück, ob sich etwas geändert hat.
  function setRest(next) {
    if (s.rest === next) return false;
    const wasOff = s.rest === REST.OFF;
    s.rest = next;
    if (next === REST.OFF) system.setBacklight(false);
    else if (wasOff) system.setBacklight(true);
    return true;
  }

  function clearRestTimers() {
    restTimers.forEach(clearTimeout);
    restTimers = [];
  }

  function scheduleRest() {
    clearRestTimers();
    if (!operating()) return;
    const toSlideshow = config.slideshowAfterMin * MIN;
    const toOff = config.offAfterMin * MIN;
    // Ohne Bilder geht das Display nach der ersten Frist direkt aus.
    restTimers.push(setTimeout(() => {
      if (setRest(toOff <= toSlideshow || !hasImages() ? REST.OFF : REST.SLIDESHOW)) changed();
    }, Math.min(toSlideshow, toOff)));
    if (toOff > toSlideshow) {
      restTimers.push(setTimeout(() => { if (setRest(REST.OFF)) changed(); }, toOff));
    }
  }

  // Touch am Display oder Bewegung am PIR.
  function activity() {
    if (!operating()) return;
    if (setRest(REST.ACTIVE)) changed();
    scheduleRest();
  }

  // --- Einrichtung ---

  function setSetup(next, extra = {}) {
    const was = operating();
    Object.assign(s, extra, { setup: next });
    const is = operating();
    if (is && !was) {
      scheduleRest();
      checkTimer = setInterval(check, CHECK_INTERVAL_MS);
    }
    if (!is && was) {
      clearRestTimers();
      setRest(REST.ACTIVE);
      clearInterval(checkTimer);
    }
    changed();
  }

  async function connect(wifi, server) {
    await system.connectWifi(wifi);
    if (!(await system.checkInternet())) throw new FrameError(NO_INTERNET.code, NO_INTERNET.message);
    await backend.check(server);
  }

  async function openHotspot(error = null) {
    clearTimeout(retryTimer);
    const hotspot = await system.startHotspot();
    setSetup(SETUP.HOTSPOT, { hotspot, error, connecting: false });
  }

  // Das Handy hat das Portal geöffnet (ab Phase 5 meldet das der Captive-Portal-Handler).
  function portalOpened() {
    if (s.setup === SETUP.HOTSPOT) setSetup(SETUP.ACCOUNT, { error: null });
  }

  // Eingaben aus dem Portal. Scheitert etwas, kommt der Hotspot nach 30 s mit der Fehlermeldung zurück.
  async function submit(input) {
    if (s.connecting || operating()) throw new FrameError("NOT_IN_SETUP", "Keine Einrichtung aktiv");
    const { wifi, server } = validate(input);
    clearTimeout(retryTimer);
    Object.assign(s, { connecting: true, connectingTo: wifi.ssid, error: null });
    changed();
    await system.stopHotspot();
    s.hotspot = null;
    try {
      await connect(wifi, server);
      Object.assign(config, { wifi, server });
      saveConfig(config);
      setSetup(SETUP.READY, { connecting: false, connectingTo: null });
    } catch (err) {
      Object.assign(s, { connecting: false, connectingTo: null, error: toError(err) });
      changed();
      retryTimer = setTimeout(() => openHotspot(s.error), HOTSPOT_RETRY_MS);
    }
  }

  // READY ⇄ OFFLINE. Ohne Internet wird das gespeicherte WLAN neu verbunden.
  async function check() {
    if (checking || !operating()) return;
    checking = true;
    try {
      s.cpuTemp = await system.readCpuTemp();
      let online = await system.checkInternet();
      if (!online && config.wifi) {
        try {
          await system.connectWifi(config.wifi);
          online = await system.checkInternet();
        } catch {}
      }
      const next = online ? SETUP.READY : SETUP.OFFLINE;
      if (!operating()) return;
      if (next !== s.setup) setSetup(next, { error: online ? null : NO_INTERNET });
      else changed();
    } finally {
      checking = false;
    }
  }

  async function boot() {
    if (!config.wifi || !config.server) return openHotspot();
    Object.assign(s, { connecting: true });
    changed();
    try {
      await connect(config.wifi, config.server);
      setSetup(SETUP.READY, { connecting: false, error: null });
    } catch (err) {
      setSetup(SETUP.OFFLINE, { connecting: false, error: toError(err) });
    }
  }

  // Zurück auf Werkseinstellung: WLAN und Server vergessen, Hotspot auf.
  async function reset() {
    Object.assign(config, { wifi: null, server: null });
    saveConfig(config);
    await openHotspot();
  }

  // --- Nur für die Dev-Leiste ---

  function force({ setup, rest }) {
    if (setup && Object.values(SETUP).includes(setup)) setSetup(setup);
    if (rest && Object.values(REST).includes(rest) && operating()) {
      setRest(rest);
      if (rest === REST.ACTIVE) scheduleRest();
      changed();
    }
  }

  function setDeadlines({ slideshowAfterMin, offAfterMin }) {
    Object.assign(config, { slideshowAfterMin, offAfterMin });
    scheduleRest();
    changed();
  }

  system.events.on("motion", activity);

  return {
    boot, snapshot, activity, portalOpened, submit, reset, check, force, setDeadlines, changed,
    on: emitter.on.bind(emitter)
  };
}

module.exports = { createFrame, validate, SETUP, REST };
