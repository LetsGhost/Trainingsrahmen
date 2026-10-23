// SystemAdapter: die einzige Stelle, die WLAN, Hotspot, PIR, Backlight und CPU-Temperatur anfasst.
//
// Schnittstelle (beide Adapter):
//   events                            EventEmitter, meldet "motion" (PIR)
//   startHotspot()                    → { ssid, password }
//   stopHotspot()
//   scanWifi()                        → [{ ssid, signal (0–100), secure }]
//   portalUrl()                       → Adresse des Einrichtungsportals aus Sicht des Handys
//   adminUrl()                        → Adresse des Admin-Bereichs im Heimnetz
//   connectWifi({ ssid, password })   wirft FrameError("WIFI_AUTH")
//   checkInternet()                   → true | false
//   setBacklight(on)
//   readCpuTemp()                     → °C | null
//   power("reboot" | "poweroff")      Pi neu starten oder herunterfahren (Admin-Bereich)
//   status()                          → { hotspot, wifi, backlight, ip, signal (dBm) } für Dev-Leiste und Admin
//
// Demo-Modus: Über dem Adapter liegt daemon/demo.js und spielt das Netz. Am PC (nicht Linux) mit dem Mock darunter.

function createSystemAdapter({ dev, demo, sim, port }) {
  const base = dev || (demo && process.platform !== "linux") ? require("./mock")({ sim, port }) : require("./pi")({ port });
  return demo ? require("../demo").withDemoNetwork(base) : base;
}

module.exports = { createSystemAdapter };
