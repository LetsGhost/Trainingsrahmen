// Holt Plan und Wetter regelmäßig und legt beides auf der Daten-Partition ab, damit nach einem Neustart
// ohne Netz der letzte Stand angezeigt wird. Abgerufen wird nur, solange der Rahmen online ist (READY).
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { mergePlans } = require("./athletept");
const { withRecovery, withActivities } = require("./garmin");

const PLAN_INTERVAL_MS = 10 * 60 * 1000;
const WEATHER_INTERVAL_MS = 30 * 60 * 1000;
// Garmin nennt keine Rate-Limits; die Uhr synchronisiert ohnehin nur ab und zu.
const GARMIN_INTERVAL_MS = 30 * 60 * 1000;

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
  // plan: Sport-Analytics, athletept: AthletePT, garmin: Erholungswerte. Jede Quelle hat ihren eigenen Cache,
  // damit ein Ausfall der einen den letzten Stand der anderen nicht verdrängt.
  const entries = { plan: cache.read("plan"), athletept: cache.read("athletept"), garmin: cache.read("garmin"), weather: cache.read("weather") };
  const errors = { plan: null, athletept: null, garmin: null, weather: null };
  const running = { plan: false, athletept: false, garmin: false, weather: false };
  // Eine entfernte Zusatzquelle zählt nicht mehr, auch wenn ihr Cache noch liegt.
  const athletept = () => (config.athletept ? entries.athletept : null);
  const garmin = () => (config.garmin ? entries.garmin : null);

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
  const syncGarmin = () => run("garmin", () => (config.garmin ? backend.fetchGarmin(config.garmin, garmin()?.data?.recovery?.hrvHistory) : undefined));
  const syncWeather = () => run("weather", () => weather.fetch(config.location));
  const syncAll = () => Promise.all([syncPlan(), syncGarmin(), syncWeather()]);

  setInterval(() => { if (isOnline()) syncPlan(); }, PLAN_INTERVAL_MS);
  setInterval(() => { if (isOnline()) syncGarmin(); }, GARMIN_INTERVAL_MS);
  setInterval(() => { if (isOnline()) syncWeather(); }, WEATHER_INTERVAL_MS);

  return {
    syncAll,
    syncPlan,
    syncGarmin,
    syncWeather,
    plan: () => {
      const merged = mergePlans(entries.plan?.data ?? null, athletept()?.data ?? null);
      return withActivities(withRecovery(merged, garmin()?.data?.recovery), garmin()?.data?.activities);
    },
    weather: () => entries.weather?.data ?? null,
    // Für Display und Dev-Leiste: Zeitpunkte des letzten Stands und letzte Fehler.
    status: () => ({
      // Neuester Stand aller Quellen, damit das Display bei jeder Änderung neu zeichnet.
      planAt: Math.max(entries.plan?.fetchedAt ?? 0, athletept()?.fetchedAt ?? 0, garmin()?.fetchedAt ?? 0) || null,
      weatherAt: entries.weather?.fetchedAt ?? null,
      planError: errors.plan ?? (config.athletept ? errors.athletept : null) ?? (config.garmin ? errors.garmin : null),
      // Für die Dev-Leiste: Garmin getrennt, null ohne Key.
      garminAt: garmin()?.fetchedAt ?? null,
      garminError: config.garmin ? errors.garmin : null,
      weatherError: errors.weather
    }),
    on: emitter.on.bind(emitter)
  };
}

module.exports = { createSync };
