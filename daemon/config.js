// Gespeicherte Einstellungen auf der Daten-Partition. Geschrieben wird atomar (tmp + rename),
// damit ein Stromausfall keine halbe Datei hinterlässt.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.FRAME_DATA || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "config.json");

const DEFAULTS = {
  wifi: null,             // { ssid, password }
  server: null,           // { url, apiKey }
  slideshowAfterMin: 5,
  offAfterMin: 30,
  // Wetter-Ort, im Admin-Bereich einstellbar.
  location: { name: "Berlin", lat: 52.52, lon: 13.405 },
  // Admin-Passwort als scrypt-Hash: { salt, hash } oder null, solange es nicht gesetzt ist.
  admin: null,
  // theme: "auto" (Nachtfenster 22–06) | "light" | "dark"
  display: { theme: "auto", showWeather: true, showRecovery: true }
};

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { ...DEFAULTS, ...saved, display: { ...DEFAULTS.display, ...saved.display } };
  } catch {
    return { ...DEFAULTS, display: { ...DEFAULTS.display } };
  }
}

function save(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = { load, save, DEFAULTS, DATA_DIR };
