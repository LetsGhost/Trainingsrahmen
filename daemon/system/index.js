// SystemAdapter: die einzige Stelle, die WLAN, Hotspot, PIR, Backlight und CPU-Temperatur anfasst.
//
// Schnittstelle (beide Adapter):
//   events                            EventEmitter, meldet "motion" (PIR)
//   startHotspot()                    → { ssid, password }
//   stopHotspot()
//   connectWifi({ ssid, password })   wirft FrameError("WIFI_AUTH")
//   checkInternet()                   → true | false
//   setBacklight(on)
//   readCpuTemp()                     → °C | null
//   status()                          → Momentaufnahme für die Dev-Leiste

function createSystemAdapter({ dev, sim }) {
  return dev ? require("./mock")({ sim }) : require("./pi")();
}

module.exports = { createSystemAdapter };
