// Zwei Zustandsautomaten:
//   Einrichtung: SETUP_HOTSPOT → SETUP_ACCOUNT → SETUP_ADMIN → READY ⇄ OFFLINE
//   Ruhe:        AKTIV → SLIDESHOW → AUS; Bewegung oder Touch führt zurück zu AKTIV
// SETUP_ADMIN: Der Rahmen ist im Heimnetz, aber noch ohne Admin-Passwort. Das Display zeigt einen QR-Code
// mit Einmal-Code zum Admin-Bereich; erst wenn dort das Passwort gesetzt ist, geht es nach READY.
// Die Ruhe-Fristen laufen nur in READY und OFFLINE; während der Einrichtung bleibt das Display an.
// Jede Änderung meldet "change" mit der vollständigen Momentaufnahme, der Server reicht sie per SSE weiter.
const { EventEmitter } = require("events");
const crypto = require("crypto");
const { FrameError } = require("./errors");

const SETUP = {
  HOTSPOT: "SETUP_HOTSPOT", ACCOUNT: "SETUP_ACCOUNT", ADMIN: "SETUP_ADMIN", READY: "READY", OFFLINE: "OFFLINE"
};
const REST = { ACTIVE: "AKTIV", SLIDESHOW: "SLIDESHOW", OFF: "AUS" };

const MIN = 60 * 1000;
const HOTSPOT_RETRY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const NO_INTERNET = { code: "NO_INTERNET", message: "Kein Internet" };
// Ohne leicht verwechselbare Zeichen (0/O, 1/I/L), falls jemand den Code abtippt.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const toError = err => ({ code: err.code ?? "UNKNOWN", message: err.message });
const newAdminCode = () => Array.from(crypto.randomBytes(6), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

// AthletePT ist optional: beide Felder leer heißt „nicht verwenden“.
function validateAthletept(input) {
  const url = String(input?.url ?? "").trim();
  const apiKey = String(input?.apiKey ?? "").trim();
  if (!url && !apiKey) return null;
  if (!/^https?:\/\/\S+$/i.test(url)) throw new FrameError("INVALID", "AthletePT-URL muss mit http:// oder https:// beginnen");
  if (!apiKey) throw new FrameError("INVALID", "AthletePT-Key fehlt");
  return { url, apiKey };
}

// Eingaben aus dem Portal prüfen und säubern. Das Portal fragt nur das WLAN ab;
// die Zugänge für die Trainingsdaten kommen danach im Admin-Bereich.
function validate({ wifi } = {}) {
  const ssid = String(wifi?.ssid ?? "").trim();
  if (!ssid) throw new FrameError("INVALID", "WLAN fehlt");
  return { wifi: { ssid, password: String(wifi.password ?? "") } };
}

function createFrame({ system, config, saveConfig, hasImages }) {
  const emitter = new EventEmitter();
  // connectingTo: WLAN-Name, solange nach dem Absenden verbunden wird.
  // adminCode: Einmal-Code für das erste Admin-Passwort; der Server gibt ihn nur an das Display (localhost) weiter.
  const s = {
    setup: null, rest: REST.ACTIVE, connecting: false, connectingTo: null, error: null, hotspot: null, cpuTemp: null,
    adminCode: null
  };
  let restTimers = [];
  let present = false;
  let retryTimer = null;
  let checkTimer = null;
  let checking = false;

  // operating: Ruhe-Fristen laufen. connected: WLAN ist eingerichtet, die Verbindung wird überwacht.
  const operating = () => s.setup === SETUP.READY || s.setup === SETUP.OFFLINE;
  const connected = () => operating() || s.setup === SETUP.ADMIN;
  // Wohin es geht, sobald Internet da ist.
  const onlineState = () => (config.admin ? SETUP.READY : SETUP.ADMIN);

  function snapshot() {
    return {
      ...s,
      portalUrl: connected() ? null : system.portalUrl(),
      adminUrl: s.setup === SETUP.ADMIN ? system.adminUrl() : null,
      deadlines: { slideshowAfterMin: config.slideshowAfterMin, offAfterMin: config.offAfterMin },
      display: config.display,
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
    // Solange der Radar jemanden sieht, laufen keine Fristen; sie starten erst, wenn er wieder geht.
    if (!operating() || present) return;
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
    const wasOperating = operating(), wasConnected = connected();
    Object.assign(s, extra, { setup: next });
    if (next === SETUP.ADMIN && !s.adminCode) s.adminCode = newAdminCode();
    if (next === SETUP.READY || !connected()) s.adminCode = null;

    if (operating() && !wasOperating) scheduleRest();
    if (!operating() && wasOperating) {
      clearRestTimers();
      setRest(REST.ACTIVE);
    }
    if (connected() && !wasConnected) {
      checkTimer = setInterval(check, CHECK_INTERVAL_MS);
      setTimeout(check, 1000);
    }
    if (!connected() && wasConnected) clearInterval(checkTimer);
    changed();
  }

  async function connect(wifi) {
    await system.connectWifi(wifi);
    if (!(await system.checkInternet())) throw new FrameError(NO_INTERNET.code, NO_INTERNET.message);
  }

  async function openHotspot(error = null) {
    clearTimeout(retryTimer);
    let hotspot;
    try {
      hotspot = await system.startHotspot();
    } catch (err) {
      // Sonst bliebe der Rahmen ohne Hotspot stehen, bis jemand den Strom zieht.
      console.error(err);
      retryTimer = setTimeout(() => openHotspot(error), HOTSPOT_RETRY_MS);
      return;
    }
    setSetup(SETUP.HOTSPOT, { hotspot, error, connecting: false });
  }

  // Das Handy hat das Portal geöffnet (meldet der Captive-Portal-Handler).
  function portalOpened() {
    if (s.setup === SETUP.HOTSPOT) setSetup(SETUP.ACCOUNT, { error: null });
  }

  // Eingaben aus dem Portal. Scheitert etwas, kommt der Hotspot nach 30 s mit der Fehlermeldung zurück.
  async function submit(input) {
    if (s.connecting || connected()) throw new FrameError("NOT_IN_SETUP", "Keine Einrichtung aktiv");
    const { wifi } = validate(input);
    clearTimeout(retryTimer);
    Object.assign(s, { connecting: true, connectingTo: wifi.ssid, error: null });
    changed();
    await system.stopHotspot();
    s.hotspot = null;
    try {
      await connect(wifi);
      config.wifi = wifi;
      saveConfig(config);
      setSetup(onlineState(), { connecting: false, connectingTo: null });
    } catch (err) {
      Object.assign(s, { connecting: false, connectingTo: null, error: toError(err) });
      changed();
      retryTimer = setTimeout(() => openHotspot(s.error), HOTSPOT_RETRY_MS);
    }
  }

  // Das Admin-Passwort ist gesetzt: Einrichtung abgeschlossen.
  function adminCompleted() {
    if (s.setup === SETUP.ADMIN) setSetup(SETUP.READY, { error: null });
  }

  // Admin-Passwort vergessen (nur am Display): zurück nach SETUP_ADMIN, das Display zeigt wieder den Einmal-Code.
  // Offline bleibt der Zustand; onlineState() führt nach dem Wiederverbinden nach SETUP_ADMIN.
  function resetAdmin() {
    config.admin = null;
    saveConfig(config);
    if (s.setup === SETUP.READY) setSetup(SETUP.ADMIN);
    else changed();
  }

  // Online ⇄ OFFLINE. Ohne Internet wird das gespeicherte WLAN neu verbunden.
  async function check() {
    if (checking || !connected()) return;
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
      if (!connected()) return;
      if (!online && s.setup !== SETUP.OFFLINE) setSetup(SETUP.OFFLINE, { error: NO_INTERNET });
      else if (online && s.setup === SETUP.OFFLINE) setSetup(onlineState(), { error: null });
      else changed();
    } finally {
      checking = false;
    }
  }

  async function boot() {
    if (!config.wifi) return openHotspot();
    Object.assign(s, { connecting: true });
    changed();
    try {
      await connect(config.wifi);
      setSetup(onlineState(), { connecting: false, error: null });
    } catch (err) {
      setSetup(SETUP.OFFLINE, { connecting: false, error: toError(err) });
    }
  }

  // Zurück in die Einrichtung: WLAN vergessen, Hotspot auf.
  // keepAdmin: aus dem Admin-Bereich („WLAN ändern“) bleiben Passwort und alle Zugänge erhalten (die stehen nur im
  // Admin, nicht im Portal); Werkseinstellung löscht sie.
  async function reset({ keepAdmin = false } = {}) {
    config.wifi = null;
    if (!keepAdmin) Object.assign(config, { admin: null, server: null, athletept: null, garmin: null });
    saveConfig(config);
    await openHotspot();
  }

  function setDeadlines({ slideshowAfterMin, offAfterMin }) {
    Object.assign(config, { slideshowAfterMin, offAfterMin });
    scheduleRest();
    changed();
  }

  // --- Nur für die Dev-Leiste ---

  // Ein erzwungener verbundener Zustand verbindet auch das (Mock-)WLAN, sonst stellt die
  // Verbindungsprüfung ihn nach spätestens 30 s wieder auf OFFLINE zurück.
  async function force({ setup, rest }) {
    if ([SETUP.READY, SETUP.OFFLINE, SETUP.ADMIN].includes(setup) && !system.status().wifi) {
      await system.stopHotspot();
      s.hotspot = null;
      await system.connectWifi(config.wifi ?? { ssid: "Dev-WLAN", password: "" });
    }
    if (setup && Object.values(SETUP).includes(setup)) setSetup(setup);
    if (rest && Object.values(REST).includes(rest) && operating()) {
      setRest(rest);
      if (rest === REST.ACTIVE) scheduleRest();
      changed();
    }
  }

  system.events.on("motion", activity); // Mock/Dev-Leiste
  system.events.on("presence", on => { present = on; activity(); });

  return {
    boot, snapshot, activity, portalOpened, submit, adminCompleted, resetAdmin, reset, check, force, setDeadlines, changed,
    adminCode: () => s.adminCode,
    on: emitter.on.bind(emitter)
  };
}

module.exports = { createFrame, validate, validateAthletept, SETUP, REST };
