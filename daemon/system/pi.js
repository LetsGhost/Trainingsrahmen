// Echter Adapter für den Pi: WLAN und Hotspot über NetworkManager (nmcli), PIR über gpiomon (libgpiod),
// Backlight über /sys/class/backlight, CPU-Temperatur aus /sys/class/thermal.
// Die Rechte dafür (nmcli ohne root, Backlight schreiben, GPIO lesen) richtet scripts/setup-pi.sh ein.
// Noch nicht auf echter Hardware geprüft (Phase 2 und 5).
const { EventEmitter } = require("events");
const { execFile, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { FrameError } = require("../errors");

const IFACE = process.env.FRAME_WIFI_IFACE || "wlan0";
// FRAME_PIR_PIN=off schaltet den Sensor ab.
const PIR_CHIP = process.env.FRAME_PIR_CHIP || "gpiochip0";
const PIR_PIN = process.env.FRAME_PIR_PIN || "17";
const HOTSPOT_CON = "rahmen-hotspot";
const WIFI_CON = "rahmen-wifi";
// Adresse, die NetworkManager im Modus „shared“ vergibt; dnsmasq leitet dort alle Namen hin (setup-pi.sh).
const HOTSPOT_IP = "10.42.0.1";
const CONNECT_TIMEOUT_S = 30;
const STATUS_INTERVAL_MS = 15 * 1000;
const CONNECTIVITY_URL = "http://connectivitycheck.gstatic.com/generate_204";
// Ohne leicht verwechselbare Zeichen, falls jemand das Hotspot-Passwort abtippt.
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function run(cmd, args, timeout = (CONNECT_TIMEOUT_S + 15) * 1000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr);
        reject(err);
      } else resolve(String(stdout));
    });
  });
}

const nmcli = (...args) => run("nmcli", args);
const quiet = promise => promise.catch(() => {});

// nmcli -t trennt Felder mit „:“ und maskiert „:“ und „\“ im Inhalt mit „\“.
function splitTerse(line) {
  const fields = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) cur += line[++i];
    else if (line[i] === ":") {
      fields.push(cur);
      cur = "";
    } else cur += line[i];
  }
  fields.push(cur);
  return fields;
}

function readFile(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

// Letzte vier Stellen der WLAN-MAC, damit zwei Rahmen nebeneinander verschiedene Hotspots haben.
const hotspotSsid = () => `Rahmen-${(readFile(`/sys/class/net/${IFACE}/address`) ?? "00:00").replace(/:/g, "").slice(-4).toUpperCase()}`;

const newPassword = () => Array.from(crypto.randomBytes(8), b => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");

function ipAddress() {
  return (os.networkInterfaces()[IFACE] ?? []).find(a => a.family === "IPv4")?.address ?? null;
}

function findBacklight() {
  try {
    const [first] = fs.readdirSync("/sys/class/backlight");
    return first ? path.join("/sys/class/backlight", first) : null;
  } catch {
    return null;
  }
}

module.exports = function createPiAdapter({ port }) {
  const events = new EventEmitter();
  const hw = { hotspot: null, wifi: null, backlight: true, ip: null, signal: null };
  const backlight = findBacklight();
  const portalPort = process.env.FRAME_PORTAL_PORT || port;
  // Zuletzt erfolgreich angelegtes WLAN; gleiche Daten → nur neu verbinden statt neu anlegen.
  let saved = null;
  // Liste von vor dem Hotspot: Im AP-Modus sieht der 3B+ (ein Funkmodul) keine anderen Netze.
  let networks = [];

  async function scan(rescan) {
    const out = await nmcli("-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list", "ifname", IFACE, "--rescan", rescan ? "yes" : "no");
    const best = new Map();
    for (const line of out.split("\n")) {
      const [ssid, signal, security] = splitTerse(line);
      if (!ssid || ssid === hw.hotspot?.ssid) continue;
      const entry = { ssid, signal: Number(signal) || 0, secure: Boolean(security) && security !== "--" };
      if ((best.get(ssid)?.signal ?? -1) < entry.signal) best.set(ssid, entry);
    }
    return [...best.values()].sort((a, b) => b.signal - a.signal);
  }

  // WLAN-Name, Signal und IP für status(); status() selbst muss synchron sein.
  async function refresh() {
    hw.ip = ipAddress();
    try {
      const out = await nmcli("-t", "-f", "ACTIVE,SSID,SIGNAL", "device", "wifi", "list", "ifname", IFACE, "--rescan", "no");
      const active = out.split("\n").map(splitTerse).find(([a]) => a === "yes");
      const inAp = Boolean(hw.hotspot);
      hw.wifi = active && !inAp ? active[1] : null;
      // nmcli liefert 0–100 %, die Schnittstelle dBm (grob: 100 % ≈ -50 dBm, 0 % ≈ -100 dBm).
      hw.signal = active && !inAp ? Math.round(Number(active[2]) / 2 - 100) : null;
    } catch {
      hw.wifi = null;
      hw.signal = null;
    }
  }
  setInterval(refresh, STATUS_INTERVAL_MS).unref();
  refresh();

  function watchPir() {
    if (PIR_PIN === "off") return;
    let logged = false;
    // libgpiod 1.x und 2.x haben unterschiedliche Aufrufe.
    run("gpiomon", ["--version"], 5000)
      .then(out => /v2\./.test(out), () => false)
      .then(function start(v2) {
        const args = v2 ? ["--edges=rising", "--chip", PIR_CHIP, PIR_PIN] : ["--rising-edge", PIR_CHIP, PIR_PIN];
        const proc = spawn("gpiomon", args, { stdio: ["ignore", "pipe", "pipe"] });
        proc.stdout.on("data", () => events.emit("motion"));
        proc.stderr.on("data", d => { if (!logged) console.error(`PIR (gpiomon): ${String(d).trim()}`); });
        proc.on("error", err => { if (!logged) console.error(`PIR: gpiomon startet nicht (${err.message})`); });
        proc.on("close", code => {
          if (!logged) console.error(`PIR: gpiomon beendet (${code}), neuer Versuch alle 10 s`);
          logged = true;
          setTimeout(() => start(v2), 10000).unref();
        });
      });
  }
  watchPir();

  return {
    name: "pi",
    events,

    async startHotspot() {
      try {
        networks = await scan(true);
      } catch {}
      await quiet(nmcli("connection", "delete", HOTSPOT_CON));
      const hotspot = { ssid: hotspotSsid(), password: newPassword() };
      await nmcli(
        "connection", "add", "type", "wifi", "ifname", IFACE, "con-name", HOTSPOT_CON, "autoconnect", "no",
        "ssid", hotspot.ssid, "802-11-wireless.mode", "ap", "802-11-wireless.band", "bg",
        "ipv4.method", "shared", "ipv4.addresses", `${HOTSPOT_IP}/24`, "ipv6.method", "disabled",
        // Nur WPA2 mit CCMP und ohne PMF: Damit kommen der Broadcom-Chip des 3B+ und ältere Handys zurecht.
        "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", hotspot.password,
        "wifi-sec.proto", "rsn", "wifi-sec.pairwise", "ccmp", "wifi-sec.group", "ccmp", "wifi-sec.pmf", "disable"
      );
      await nmcli("connection", "up", HOTSPOT_CON);
      Object.assign(hw, { hotspot, wifi: null, signal: null });
      return hotspot;
    },

    async stopHotspot() {
      await quiet(nmcli("connection", "down", HOTSPOT_CON));
      hw.hotspot = null;
    },

    async scanWifi() {
      if (hw.hotspot) return networks;
      try {
        networks = await scan(true);
      } catch {}
      return networks;
    },

    portalUrl() {
      return `http://${HOTSPOT_IP}${String(portalPort) === "80" ? "" : `:${portalPort}`}/setup`;
    },

    adminUrl() {
      return `http://${ipAddress() ?? `${os.hostname()}.local`}:${port}/admin`;
    },

    async connectWifi({ ssid, password }) {
      const same = saved && saved.ssid === ssid && saved.password === password;
      // Bei Internetausfall ruft state.js das alle 30 s auf; steht das WLAN selbst, nicht neu verbinden.
      await refresh();
      if (same && hw.wifi === ssid) return;
      if (!same) {
        await quiet(nmcli("connection", "delete", WIFI_CON));
        const security = password ? ["wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", password] : [];
        try {
          await nmcli("connection", "add", "type", "wifi", "ifname", IFACE, "con-name", WIFI_CON, "autoconnect", "yes", "ssid", ssid, ...security);
        } catch (err) {
          // nmcli prüft die Länge des Passworts (8–63 Zeichen) schon beim Anlegen.
          if (/psk/i.test(err.stderr)) throw new FrameError("WIFI_AUTH", "WLAN-Passwort ungültig");
          throw new FrameError("WIFI_FAILED", "WLAN konnte nicht angelegt werden");
        }
        saved = null;
      }
      try {
        await nmcli("--wait", String(CONNECT_TIMEOUT_S), "connection", "up", WIFI_CON);
      } catch (err) {
        await refresh();
        if (/secrets were required|802-1x|authentication|psk/i.test(err.stderr)) throw new FrameError("WIFI_AUTH", "WLAN-Passwort falsch");
        if (/no network with ssid|not found/i.test(err.stderr)) throw new FrameError("WIFI_NOT_FOUND", `WLAN „${ssid}“ nicht gefunden`);
        throw new FrameError("WIFI_FAILED", "WLAN-Verbindung fehlgeschlagen");
      }
      saved = { ssid, password };
      await refresh();
    },

    async checkInternet() {
      try {
        const res = await fetch(CONNECTIVITY_URL, { signal: AbortSignal.timeout(5000), redirect: "manual" });
        return res.status === 204;
      } catch {
        return false;
      }
    },

    // Ohne Backlight unter /sys (z. B. HDMI-Display) bleibt nur das schwarze Bild des Displays im Zustand AUS.
    async setBacklight(on) {
      hw.backlight = on;
      if (!backlight) return;
      try {
        fs.writeFileSync(path.join(backlight, "bl_power"), on ? "0" : "4");
      } catch (err) {
        console.error(`Backlight: ${err.message}`);
      }
    },

    async readCpuTemp() {
      const milli = Number(readFile("/sys/class/thermal/thermal_zone0/temp"));
      return Number.isFinite(milli) && milli > 0 ? Math.round(milli / 100) / 10 : null;
    },

    status() {
      return { adapter: "pi", ...hw, backlightControl: Boolean(backlight) };
    }
  };
};
