// SystemAdapter: die einzige Stelle, die WLAN, Hotspot, PIR, Backlight und CPU-Temperatur anfasst.
//
// Schnittstelle (beide Adapter):
//   events                            EventEmitter, meldet "motion" (PIR)
//   startHotspot()                    → { ssid, password }
//   stopHotspot()
//   scanWifi()                        → [{ ssid, signal (0–100), secure }]
//   portalUrl()                       → Adresse des Einrichtungsportals aus Sicht des Handys
//   connectWifi({ ssid, password })   wirft FrameError("WIFI_AUTH")
//   checkInternet()                   → true | false
//   setBacklight(on)
//   readCpuTemp()                     → °C | null
//   status()                          → Momentaufnahme für die Dev-Leiste

function createSystemAdapter({ dev, sim, port }) {
  return dev ? require("./mock")({ sim, port }) : require("./pi")();
}

module.exports = { createSystemAdapter };
