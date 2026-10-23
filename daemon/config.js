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
  slideshowAfterMin: 5,
  offAfterMin: 30,
  // Wetter-Ort, im Admin-Bereich einstellbar.
  location: { name: "Berlin", lat: 52.52, lon: 13.405 },
  // Admin-Passwort als scrypt-Hash: { salt, hash } oder null, solange es nicht gesetzt ist.
  admin: null,
  // theme: "auto" (Nachtfenster 22–06) | "light" | "dark"
  display: { theme: "auto", showWeather: true, showRecovery: true },
  // Update-Knopf: von diesem Remote und Branch wird gezogen.
  update: { remote: "origin", branch: "master" }
};

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return {
      ...DEFAULTS,
      ...saved,
      display: { ...DEFAULTS.display, ...saved.display },
      update: { ...DEFAULTS.update, ...saved.update }
    };
  } catch {
    return { ...DEFAULTS, display: { ...DEFAULTS.display }, update: { ...DEFAULTS.update } };
  }
}

function save(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, FILE);
}

const exists = () => fs.existsSync(FILE);

module.exports = { load, save, exists, DEFAULTS, DATA_DIR, BASE_DIR, DEMO };
