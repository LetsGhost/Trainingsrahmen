// Gespeicherte Einstellungen auf der Daten-Partition. Geschrieben wird atomar (tmp + rename),
// damit ein Stromausfall keine halbe Datei hinterlässt.
const fs = require("fs");
const path = require("path");

// BASE_DIR: data/ im Projekt; dort liegen auch frame.env (Demo-Schalter) und update.env für die systemd-Units.
// Im Demo-Modus (FRAME_DEMO=1) liegen Einstellungen, Cache und Bilder getrennt unter data/demo/, die echten bleiben unberührt.
const DEMO = process.env.FRAME_DEMO === "1";
const BASE_DIR = path.join(__dirname, "..", "data");
const DATA_DIR = process.env.FRAME_DATA || (DEMO ? path.join(BASE_DIR, "demo") : BASE_DIR);
const FILE = path.join(DATA_DIR, "config.json");

const DEFAULTS = {
  wifi: null,             // { ssid, password }
  server: null,           // { url, apiKey }: Sport-Analytics
  athletept: null,        // { url, apiKey } oder null: AthletePT 3.0, optional, ergänzt den Plan
  garmin: null,           // { apiKey } oder null: Garmin Personal API, optional, Erholungswerte mit Vorrang
  slideshowAfterMin: 5,
  offAfterMin: 30,
  // Wetter-Ort, im Admin-Bereich einstellbar.
  location: { name: "Berlin", lat: 52.52, lon: 13.405 },
  // Admin-Passwort als scrypt-Hash: { salt, hash } oder null, solange es nicht gesetzt ist.
  admin: null,
  // theme: "auto" (dunkel von darkFrom bis darkTo Uhr) | "light" | "dark"; brightness: "low" | "mid" | "high"; skin: "modern" | "sport";
  // tone: "pale" | "warm" | "sand" (Hintergrund des hellen Sport-Designs) (alle drei nur in den Einstellungen am Rahmen)
  display: { theme: "auto", darkFrom: 22, darkTo: 6, showWeather: true, showRecovery: true, brightness: "high", skin: "modern", tone: "sand" },
  // Radar (HLK-LD2410C): gates = Reichweite in Toren zu 0,75 m (1–8); sensitivity: "low" | "mid" | "high"
  sensor: { gates: 6, sensitivity: "mid" },
  // Nachtruhe: von from bis to Uhr (volle Stunden) zählt der Radar nicht, nur Touch weckt; from: null = aus.
  night: { from: 22, to: 7 },
  // Update-Knopf: von diesem Remote und Branch wird gezogen.
  update: { remote: "origin", branch: "production" }
};

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return {
      ...DEFAULTS,
      ...saved,
      display: { ...DEFAULTS.display, ...saved.display },
      sensor: { ...DEFAULTS.sensor, ...saved.sensor },
      night: { ...DEFAULTS.night, ...saved.night },
      // Update-Quelle ist fest, alte gespeicherte Werte (z. B. master) zählen nicht.
      update: { ...DEFAULTS.update }
    };
  } catch {
    return { ...DEFAULTS, display: { ...DEFAULTS.display }, sensor: { ...DEFAULTS.sensor }, night: { ...DEFAULTS.night }, update: { ...DEFAULTS.update } };
  }
}

// Für alle Dateien des Daemons (Konfiguration, Cache, Sitzungen, Update-Status).
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", text);
  fs.renameSync(file + ".tmp", file);
}

const save = config => writeAtomic(FILE, JSON.stringify(config, null, 2));

const exists = () => fs.existsSync(FILE);

module.exports = { load, save, exists, writeAtomic, DEFAULTS, DATA_DIR, BASE_DIR, DEMO };
