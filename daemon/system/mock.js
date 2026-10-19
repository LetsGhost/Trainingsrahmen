// Mock-Adapter für FRAME_ENV=dev. Fehler kommen aus den Schaltern in `sim`, die die Dev-Leiste setzt.
const { EventEmitter } = require("events");
const { FrameError } = require("../errors");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = function createMockAdapter({ sim }) {
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
      return { adapter: "mock", ...hw };
    }
  };
};
