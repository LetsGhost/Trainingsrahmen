// Echter Adapter für den Pi: WLAN über NetworkManager (nmcli), Hotspot über hostapd + dnsmasq
// (scripts/systemd/trainingsrahmen-hotspot.service), Radar-Präsenzsensor über gpiomon (libgpiod), seine Einstellungen
// über die serielle Schnittstelle (scripts/ld2410-bridge.py, Protokoll in ld2410.js),
// Backlight über /sys/class/backlight, CPU-Temperatur aus /sys/class/thermal.
// Die Rechte dafür (nmcli ohne root, Backlight schreiben, GPIO lesen) richtet scripts/setup-pi.sh ein.
// Noch nicht auf echter Hardware geprüft (Phase 2 und 5).
const { EventEmitter } = require("events");
const { execFile, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { FrameError } = require("../errors");
const { BASE_DIR } = require("../config");
const ld2410 = require("./ld2410");

const IFACE = process.env.FRAME_WIFI_IFACE || "wlan0";
// FRAME_PIR_PIN=off schaltet den Sensor ab.
const PIR_CHIP = process.env.FRAME_PIR_CHIP || "gpiochip0";
const PIR_PIN = process.env.FRAME_PIR_PIN || "17";
// UART des Radars (TX/RX an GPIO 15/14); FRAME_SENSOR_UART=off schaltet das Einstellen ab.
const SENSOR_UART = process.env.FRAME_SENSOR_UART || "/dev/serial0";
const SENSOR_BRIDGE = path.join(__dirname, "..", "..", "scripts", "ld2410-bridge.py");
// Ohne Messwert so lange gilt der Sensor als nicht erreichbar (er schickt rund 10 pro Sekunde).
const SENSOR_STALE_MS = 3000;
// Nicht über NetworkManager: Der kündigt im AP-Modus immer auch WPA-PSK-SHA256 an, daran scheitert der
// Broadcom-Chip (BCM43430) beim Handshake, Handys melden „Passwort falsch“. hostapd mit reinem WPA-PSK geht.
const HOTSPOT_UNIT = "trainingsrahmen-hotspot.service";
const HOTSPOT_CONF = path.join(BASE_DIR, "hostapd.conf");
const WIFI_CON = "rahmen-wifi";
// Fest in der Hotspot-Unit; dnsmasq dort leitet alle Namen hierhin.
const HOTSPOT_IP = "10.42.0.1";
const WIFI_COUNTRY = process.env.FRAME_WIFI_COUNTRY || "DE";
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
const systemctl = (...args) => run("systemctl", args);
const quiet = promise => promise.catch(() => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

// SSID und Passwort der gespeicherten Rahmen-Verbindung, null ohne Verbindung.
// shortcut: SSIDs mit „:“ oder „\“ maskiert nmcli; die passen dann nicht und werden einmal neu angelegt.
async function savedConnection() {
  try {
    const get = async field => (await nmcli("-s", "-g", field, "connection", "show", WIFI_CON)).trim();
    const ssid = await get("802-11-wireless.ssid");
    // Offene Netze haben keinen Sicherheitsteil; dann scheitert die Abfrage, das Passwort ist leer.
    return { ssid, password: await get("802-11-wireless-security.psk").catch(() => "") };
  } catch {
    return null;
  }
}

function ipAddress() {
  return (os.networkInterfaces()[IFACE] ?? []).find(a => a.family === "IPv4")?.address ?? null;
}

const BRIGHTNESS = { low: 0.2, mid: 0.55, high: 1 };

function findBacklight() {
  try {
    const [first] = fs.readdirSync("/sys/class/backlight");
    return first ? path.join("/sys/class/backlight", first) : null;
  } catch {
    return null;
  }
}

module.exports = function createPiAdapter({ port, sensor: sensorSettings }) {
  const events = new EventEmitter();
  const hw = { hotspot: null, wifi: null, backlight: true, ip: null, signal: null };
  const backlight = findBacklight();
  let level = "high";
  const writeBrightness = () => {
    const max = Number(readFile(path.join(backlight, "max_brightness"))) || 255;
    // Waveshare-Treiber (10-0045) ignoriert bl_power teils; erst brightness 0 macht das Licht wirklich aus.
    const value = hw.backlight ? Math.max(1, Math.round(max * BRIGHTNESS[level])) : 0;
    fs.writeFileSync(path.join(backlight, "brightness"), String(value));
  };
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

  // Radar-Präsenzsensor (z. B. HLK-LD2410): OUT bleibt HIGH, solange jemand da ist, auch wer still sitzt.
  // Daher beide Flanken: "presence" true/false statt einzelner "motion"-Pulse.
  function watchPir() {
    if (PIR_PIN === "off") return;
    let logged = false;
    // libgpiod 1.x und 2.x haben unterschiedliche Aufrufe.
    run("gpiomon", ["--version"], 5000)
      .then(out => /v2\./.test(out), () => false)
      .then(async function start(v2) {
        // Pegel vor gpiomon lesen (beide wollen die Leitung): wer schon vor dem Rahmen sitzt, erzeugt keine Flanke.
        await run("gpioget", v2 ? ["--chip", PIR_CHIP, PIR_PIN] : [PIR_CHIP, PIR_PIN], 5000)
          .then(out => events.emit("presence", /=active|^\s*1/.test(out)), () => {});
        const args = v2 ? ["--edges=both", "--chip", PIR_CHIP, PIR_PIN] : [PIR_CHIP, PIR_PIN];
        // stdbuf -oL: gpiomon puffert sonst in der Pipe, Flanken kämen verspätet an.
        const proc = spawn("stdbuf", ["-oL", "gpiomon", ...args], { stdio: ["ignore", "pipe", "pipe"] });
        readline.createInterface({ input: proc.stdout }).on("line", line => {
          if (/falling/i.test(line)) events.emit("presence", false);
          else if (/rising/i.test(line)) events.emit("presence", true);
        });
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

  // Radar-Einstellungen: beim ersten Messwert nach jedem (Neu-)Start der Brücke die gespeicherten schreiben,
  // damit ein getauschter oder per App verstellter Sensor wieder zur Konfiguration passt.
  let radar = null;
  const radarOnline = () => Date.now() - (radar?.latest()?.at ?? 0) < SENSOR_STALE_MS;
  function watchRadar() {
    if (SENSOR_UART === "off") return;
    let logged = false;
    (function start() {
      const proc = spawn("python3", [SENSOR_BRIDGE, SENSOR_UART], { stdio: ["pipe", "pipe", "pipe"] });
      const link = ld2410.createSensor(buf => proc.stdin.write(buf));
      let applied = false;
      proc.stdout.on("data", chunk => {
        link.push(chunk);
        if (applied || !link.latest()) return;
        applied = true;
        radar = link;
        link.configure(sensorSettings).catch(err => console.error(`Radar: ${err.message}`));
      });
      proc.stdin.on("error", () => {});
      proc.stderr.on("data", d => { if (!logged) console.error(`Radar (UART): ${String(d).trim()}`); });
      proc.on("error", err => { if (!logged) console.error(`Radar: Brücke startet nicht (${err.message})`); });
      proc.on("close", code => {
        if (!logged) console.error(`Radar: Brücke beendet (${code}), neuer Versuch alle 10 s`);
        logged = true;
        if (radar === link) radar = null;
        setTimeout(start, 10000).unref();
      });
    })();
  }
  watchRadar();

  // Hotspot aus und wlan0 zurück an NetworkManager. Auch nach einem Daemon-Neustart, wenn die Unit noch läuft.
  async function stationMode() {
    await quiet(systemctl("stop", HOTSPOT_UNIT));
    await quiet(nmcli("device", "set", IFACE, "managed", "yes"));
    // Erst wenn wlan0 nicht mehr „unmanaged“/„unavailable“ ist, klappt „connection up“.
    for (let i = 0; i < 20; i++) {
      const state = await nmcli("-g", "GENERAL.STATE", "device", "show", IFACE).catch(() => "");
      if (state && !/unmanaged|unavailable/.test(state)) return;
      await sleep(500);
    }
  }

  return {
    name: "pi",
    events,

    async startHotspot() {
      try {
        networks = await scan(true);
      } catch {}
      const hotspot = { ssid: hotspotSsid(), password: newPassword() };
      // SSID und Passwort enthalten nur Buchstaben, Ziffern und „-“, brauchen also kein Escaping.
      const conf = [
        `interface=${IFACE}`, "driver=nl80211", `ssid=${hotspot.ssid}`, "hw_mode=g", "channel=6",
        `country_code=${WIFI_COUNTRY}`, "wpa=2", "wpa_key_mgmt=WPA-PSK", "rsn_pairwise=CCMP",
        `wpa_passphrase=${hotspot.password}`
      ].join("\n") + "\n";
      fs.mkdirSync(BASE_DIR, { recursive: true });
      fs.writeFileSync(HOTSPOT_CONF, conf, { mode: 0o600 });
      // NetworkManager muss wlan0 freigeben, sonst kommen sich wpa_supplicant und hostapd in die Quere.
      await nmcli("device", "set", IFACE, "managed", "no");
      await systemctl("restart", HOTSPOT_UNIT);
      Object.assign(hw, { hotspot, wifi: null, signal: null });
      return hotspot;
    },

    async stopHotspot() {
      await stationMode();
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
      // Nach einem Neustart des Daemons die vorhandene Verbindung übernehmen, statt sie alle 30 s neu anzulegen.
      if (!saved) saved = await savedConnection();
      const same = saved && saved.ssid === ssid && saved.password === password;
      // Bei Internetausfall ruft state.js das alle 30 s auf; steht das WLAN selbst, nicht neu verbinden.
      await refresh();
      if (same && hw.wifi === ssid) return;
      await stationMode();
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
      // Getrennt: Scheitert bl_power (Rechte, Treiber), muss brightness 0 trotzdem geschrieben werden.
      try {
        writeBrightness();
      } catch (err) {
        console.error(`Backlight brightness: ${err.message}`);
      }
      try {
        fs.writeFileSync(path.join(backlight, "bl_power"), on ? "0" : "4");
      } catch (err) {
        console.error(`Backlight bl_power: ${err.message}`);
      }
    },

    // Anteil von max_brightness; shortcut: Stufen geschätzt, am Pi nachmessen, ob „Niedrig“ nachts nicht zu hell ist.
    async setBrightness(next) {
      level = next;
      if (!backlight) return;
      try {
        writeBrightness();
      } catch (err) {
        console.error(`Helligkeit: ${err.message}`);
      }
    },

    // Darf der Rahmen-User laut polkit-Regel (scripts/system/trainingsrahmen.rules).
    async power(action) {
      try {
        await systemctl(action === "reboot" ? "reboot" : "poweroff");
      } catch (err) {
        throw new FrameError("POWER_FAILED", `${action === "reboot" ? "Neustart" : "Herunterfahren"} gescheitert: ${err.stderr?.trim() || err.message}`);
      }
    },

    // Gespeichert wird erst, wenn der Sensor bestätigt; sonst Fehler, damit die Oberfläche es anzeigt.
    async configureSensor(settings) {
      if (!radarOnline()) throw new FrameError("SENSOR_OFFLINE", "Sensor antwortet nicht (Kabel TX/RX?)");
      await radar.configure(settings);
      sensorSettings = settings;
    },

    sensor() {
      const latest = radarOnline() ? radar.latest() : null;
      return { online: Boolean(latest), present: Boolean(latest?.target), distanceCm: latest?.target ? latest.distanceCm : null };
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
