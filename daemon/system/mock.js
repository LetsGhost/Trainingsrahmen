// Mock-Adapter für FRAME_ENV=dev. Fehler kommen aus den Schaltern in `sim`, die die Dev-Leiste setzt.
const { EventEmitter } = require("events");
const os = require("os");
const { FrameError } = require("../errors");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const NETWORKS = [
  { ssid: "Heimnetz", signal: 82, secure: true },
  { ssid: "FRITZ!Box 7590 KQ", signal: 54, secure: true },
  { ssid: "Nachbar-Gast", signal: 21, secure: false }
];

// Erste LAN-Adresse des PCs, damit ein echtes Handy im selben Netz das Portal per QR öffnen kann.
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    const found = list.find(a => a.family === "IPv4" && !a.internal);
    if (found) return found.address;
  }
  return "localhost";
}

module.exports = function createMockAdapter({ sim, port }) {
  const events = new EventEmitter();
  const hw = { hotspot: null, wifi: null, backlight: true };

  return {
    name: "mock",
    events,

    async startHotspot() {
      hw.wifi = null;
      hw.hotspot = { ssid: "Rahmen-DEV1", password: "training42" };
      return hw.hotspot;
    },

    async stopHotspot() {
      hw.hotspot = null;
    },

    async scanWifi() {
      await delay(300);
      return NETWORKS;
    },

    // Adresse des Portals, wie das Handy sie erreicht.
    portalUrl() {
      return `http://${lanAddress()}:${port}/setup`;
    },

    // Adresse des Admin-Bereichs im Heimnetz.
    adminUrl() {
      return `http://${lanAddress()}:${port}/admin`;
    },

    async connectWifi({ ssid }) {
      await delay(800);
      if (sim.wrongPassword) throw new FrameError("WIFI_AUTH", "WLAN-Passwort falsch");
      hw.wifi = ssid;
    },

    async checkInternet() {
      return hw.wifi !== null && !sim.noInternet;
    },

    async setBacklight(on) {
      hw.backlight = on;
    },

    async readCpuTemp() {
      return Math.round((46 + Math.random() * 4) * 10) / 10;
    },

    // Nur im Mock: die Dev-Leiste löst Bewegung aus.
    triggerMotion() {
      events.emit("motion");
    },

    status() {
      return { adapter: "mock", ...hw, ip: hw.wifi ? lanAddress() : null, signal: hw.wifi ? -52 : null };
    }
  };
};
