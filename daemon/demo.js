// Demo-Modus (FRAME_DEMO=1): Der Rahmen startet ohne Einrichtung direkt im Plan, mit Testplan und Testwetter
// aus fixtures/. WLAN, Hotspot und Internet werden nur gespielt; Backlight, PIR und CPU-Temperatur bleiben echt.
// Eigene Daten unter data/demo/, Admin-Passwort „demo1234“.
const { hashPassword } = require("./admin");

const DEMO_PASSWORD = "demo1234";
const NETWORKS = [
  { ssid: "Demo-WLAN", signal: 78, secure: true },
  { ssid: "Gast", signal: 40, secure: false }
];

// Erster Start im Demo-Modus: alles so eintragen, als wäre die Einrichtung schon durch. Kurze Fristen zum Vorführen.
// AthletePT und Garmin sind an (Fixtures), damit Zusatz-Einheiten, Häkchen, ungeplante Einheiten und die
// Erholungs-Ansicht zu sehen sind; im Admin lassen sie sich entfernen.
function seedConfig(config) {
  Object.assign(config, {
    wifi: { ssid: "Demo-WLAN", password: "" },
    server: { url: "https://demo.invalid", apiKey: "demo" },
    athletept: { url: "https://demo.invalid", apiKey: "apt_demo" },
    garmin: { apiKey: "demo" },
    admin: hashPassword(DEMO_PASSWORD),
    slideshowAfterMin: 1,
    offAfterMin: 3
  });
}

// Legt sich über den echten Adapter und ersetzt alles, was das Netz anfasst.
function withDemoNetwork(base) {
  let hotspot = null;
  return {
    ...base,
    name: `${base.name}+demo`,
    async startHotspot() {
      hotspot = { ssid: "Rahmen-DEMO", password: "demo1234" };
      return hotspot;
    },
    async stopHotspot() {
      hotspot = null;
    },
    async scanWifi() {
      return NETWORKS;
    },
    // Den gespielten Hotspot gibt es nicht; das Portal ist über das echte Netz erreichbar.
    portalUrl() {
      return base.adminUrl().replace(/\/admin$/, "/setup");
    },
    async connectWifi() {},
    async checkInternet() {
      return true;
    },
    status() {
      return { ...base.status(), adapter: `${base.status().adapter}+demo`, hotspot, wifi: hotspot ? null : "Demo-WLAN" };
    }
  };
}

module.exports = { seedConfig, withDemoNetwork, DEMO_PASSWORD };
