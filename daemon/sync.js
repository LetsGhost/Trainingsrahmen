// Holt Plan und Wetter regelmäßig und legt beides auf der Daten-Partition ab, damit nach einem Neustart
// ohne Netz der letzte Stand angezeigt wird. Abgerufen wird nur, solange der Rahmen online ist (READY).
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { mergePlans } = require("./athletept");

const PLAN_INTERVAL_MS = 10 * 60 * 1000;
const WEATHER_INTERVAL_MS = 30 * 60 * 1000;

const toError = err => ({ code: err.code ?? "UNKNOWN", message: err.message });

// Ein Eintrag pro Datei: { fetchedAt, data }. Schreiben atomar wie bei der Konfiguration.
function createCache(dir) {
  const file = name => path.join(dir, `${name}.json`);
  return {
    read(name) {
      try { return JSON.parse(fs.readFileSync(file(name), "utf8")); } catch { return null; }
    },
    write(name, entry) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file(name) + ".tmp", JSON.stringify(entry));
      fs.renameSync(file(name) + ".tmp", file(name));
    }
  };
}

function createSync({ backend, weather, config, dataDir, isOnline }) {
  const emitter = new EventEmitter();
  const cache = createCache(path.join(dataDir, "cache"));
  // plan: Sport-Analytics, athletept: AthletePT. Jede Quelle hat ihren eigenen Cache, damit ein Ausfall
  // der einen den letzten Stand der anderen nicht verdrängt.
  const entries = { plan: cache.read("plan"), athletept: cache.read("athletept"), weather: cache.read("weather") };
  const errors = { plan: null, athletept: null, weather: null };
  const running = { plan: false, athletept: false, weather: false };
  // Eine entfernte AthletePT-Quelle zählt nicht mehr, auch wenn ihr Cache noch liegt.
  const athletept = () => (config.athletept ? entries.athletept : null);

  // Gemeinsamer Ablauf für Plan und Wetter: abrufen, cachen, Fehler merken, Änderung melden.
  async function run(name, load) {
    if (running[name]) return;
    running[name] = true;
    try {
      const data = await load();
      if (data === undefined) return;
      entries[name] = { fetchedAt: Date.now(), data };
      cache.write(name, entries[name]);
      errors[name] = null;
    } catch (err) {
      errors[name] = toError(err);
    } finally {
      running[name] = false;
      emitter.emit("change");
    }
  }

  const syncPlan = () => Promise.all([
    run("plan", () => (config.server ? backend.fetchPlan(config.server) : undefined)),
    run("athletept", () => (config.athletept ? backend.fetchAthletept(config.athletept) : undefined))
  ]);
  const syncWeather = () => run("weather", () => weather.fetch(config.location));
  const syncAll = () => Promise.all([syncPlan(), syncWeather()]);

  setInterval(() => { if (isOnline()) syncPlan(); }, PLAN_INTERVAL_MS);
  setInterval(() => { if (isOnline()) syncWeather(); }, WEATHER_INTERVAL_MS);

  return {
    syncAll,
    syncPlan,
    syncWeather,
    plan: () => mergePlans(entries.plan?.data ?? null, athletept()?.data ?? null),
    weather: () => entries.weather?.data ?? null,
    // Für Display und Dev-Leiste: Zeitpunkte des letzten Stands und letzte Fehler.
    status: () => ({
      // Neuester Stand beider Quellen, damit das Display bei jeder Änderung neu zeichnet.
      planAt: Math.max(entries.plan?.fetchedAt ?? 0, athletept()?.fetchedAt ?? 0) || null,
      weatherAt: entries.weather?.fetchedAt ?? null,
      planError: errors.plan ?? (config.athletept ? errors.athletept : null),
      weatherError: errors.weather
    }),
    on: emitter.on.bind(emitter)
  };
}

module.exports = { createSync };
