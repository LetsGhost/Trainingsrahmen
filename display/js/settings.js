// Einstellungen am Rahmen (Einstellungen.dc.html): Tipp auf das Sync-Symbol im Wochenplan öffnet sie.
// Links die Tabs Status · Anzeige · Anpassen · System, rechts der Inhalt. Gefährliches (WLAN ändern, Neustart, Aus) braucht 2 s Halten.
import { hhmm, esc } from "./util.js";

export const TABS = [["status", "STATUS"], ["display", "ANZEIGE"], ["customize", "ANPASSEN"], ["system", "SYSTEM"]];
const SOURCES = [["plan", "Sport-Analytics"], ["athletept", "AthletePT"], ["garmin", "Garmin"], ["weather", "Wetter"]];
// Raster der Stepper; Grenzen wie im Admin (Slideshow 1–120, Display aus danach bis 600).
const STEPS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 600];
const SLIDESHOW_MAX = 120, OFF_MAX = 600;
export const stepUp = v => STEPS.find(s => s > v);
export const stepDown = v => [...STEPS].reverse().find(s => s < v);

const time = ms => hhmm(new Date(ms));
// Dev-Presets haben Bruchteile von Minuten.
const minutes = v => (v < 1 ? `${Math.round(v * 60)} s` : `${v} min`);

// signal in dBm → 0–4 Balken
export const bars = dbm => (dbm == null ? 0 : [-85, -75, -65, -55].filter(t => dbm >= t).length);

function hold(action, label, { big = false, warn = false } = {}) {
  return `
    <button type="button" class="st-hold${big ? " big" : ""}${warn ? " warn" : ""}" data-hold="${action}">
      <span class="st-hold-fill"></span>
      <span class="st-hold-label">${label}</span>
      <span class="st-hold-hint">2 s halten</span><span class="st-hold-hint on">gedrückt halten</span>
    </button>`;
}

function sourceRow([key, name], src, offline) {
  let mark = "", value;
  if (!src?.configured) [mark, value] = [" dim", "nicht eingerichtet · im Admin"];
  else if (src.running) [mark, value] = [" pending", "lädt …"];
  else if (offline) [mark, value] = [" pending", src.at ? `Stand ${time(src.at)}` : "noch kein Stand"];
  else if (src.error) [mark, value] = [" error", `${src.error.message}${src.at ? ` · Stand ${time(src.at)}` : ""}`];
  else value = src.at ? time(src.at) : "noch kein Stand";
  return `<div class="st-src${mark}"><span class="st-dot"></span><span class="st-src-name">${name}</span><span class="st-src-value">${esc(value)}</span></div>`;
}

function renderStatus({ daemon, sync, syncing }) {
  const offline = daemon?.setup === "OFFLINE";
  const sys = daemon?.system ?? {};
  const n = offline ? 0 : bars(sys.signal);
  const wifi = offline
    ? `<div class="st-wifi-name warn">${sys.wifi ? "Kein Internet" : "Nicht verbunden"}</div>
       <div class="st-wifi-sub">${sys.wifi ? esc(sys.wifi) : "WLAN getrennt"} · neuer Versuch alle 30 s</div>`
    : `<div class="st-wifi-name">${esc(sys.wifi ?? "–")}</div>
       <div class="st-wifi-sub">rahmen.local${sys.ip ? ` · ${esc(sys.ip)}` : ""}</div>`;

  const sources = sync?.sources ?? {};
  const configured = SOURCES.map(([k]) => sources[k]).filter(s => s?.configured);
  const errors = configured.filter(s => s.error && !s.running).length;
  const running = configured.filter(s => s.running).length;
  const last = Math.max(0, ...configured.map(s => s.at ?? 0));
  const note = offline ? `<div class="st-note">LETZTER STAND</div>` : errors ? `<div class="st-note warn">${errors} FEHLER</div>` : "";

  let button;
  if (offline) button = `<button type="button" class="st-sync off" disabled><span>Jetzt synchronisieren</span><span>nur mit WLAN</span></button>`;
  else if (syncing || running) {
    button = `<button type="button" class="st-sync busy" disabled><span>Synchronisiere …</span><span>${configured.length - running} von ${configured.length} Quellen</span></button>`;
  } else button = `<button type="button" class="st-sync" data-action="sync"><span>Jetzt synchronisieren</span><span>${last ? `zuletzt ${time(last)}` : ""}</span></button>`;

  return `
    <div class="st-kicker st-modern">WLAN</div>
    <div class="st-wifi">
      <div class="st-wifi-left">
        <span class="st-bars" role="img" aria-label="Signal ${n} von 4">${[1, 2, 3, 4].map(i => `<span${i <= n ? ' class="on"' : ""}></span>`).join("")}</span>
        <div class="st-wifi-text">${wifi}</div>
      </div>
      ${hold("wifi-reset", "WLAN ändern")}
    </div>
    <div class="st-rule"></div>
    <div class="st-card">
      <div class="st-kicker-row"><div class="st-kicker">DATENQUELLEN</div>${note}</div>
      <div class="st-sources">${SOURCES.map(s => sourceRow(s, sources[s[0]], offline)).join("")}</div>
    </div>
    <div class="st-grow"></div>
    ${button}`;
}

function segment(key, value, options) {
  return `<div class="st-seg">${options.map(([v, label]) =>
    `<button type="button" aria-pressed="${v === value}" data-set="${key}" data-value="${v}">${label}</button>`).join("")}</div>`;
}

function stepper(key, label, sub, value, canDown, canUp) {
  return `
    <div class="st-step-row">
      <div><div class="st-step-label">${label}</div><div class="st-step-sub">${sub}</div></div>
      <div class="st-stepper">
        <button type="button" aria-label="Weniger" data-step="${key}" data-dir="-1"${canDown ? "" : " disabled"}>−</button>
        <div class="st-step-value">${minutes(value)}</div>
        <button type="button" aria-label="Mehr" data-step="${key}" data-dir="1"${canUp ? "" : " disabled"}>+</button>
      </div>
    </div>`;
}

function renderDisplay({ settings, deadlines }) {
  const { slideshowAfterMin: slide, offAfterMin: off } = deadlines;
  return `
    <div class="st-card">
      <div class="st-kicker">HELLIGKEIT</div>
      ${segment("brightness", settings.brightness ?? "high", [["low", "Niedrig"], ["mid", "Mittel"], ["high", "Hoch"]])}
      <div class="st-kicker gap">THEME</div>
      ${segment("theme", settings.theme, [["auto", "Auto <span>22–06</span>"], ["light", "Hell"], ["dark", "Dunkel"]])}
    </div>
    <div class="st-rule tight"></div>
    <div class="st-card">
    <div class="st-kicker">RUHE-FRISTEN</div>
    ${stepper("slideshowAfterMin", "Slideshow nach", "ohne Berührung", slide, stepDown(slide) !== undefined,
      (stepUp(slide) ?? Infinity) < off && stepUp(slide) <= SLIDESHOW_MAX)}
    ${stepper("offAfterMin", "Display aus nach", "immer später als die Slideshow", off, (stepDown(off) ?? 0) > slide, stepUp(off) <= OFF_MAX)}
    </div>`;
}

// Theme = Aussehen aller Screens (Modern: bisheriges Layout, Sport: Sport-Edition.dc). Hell/Dunkel bleibt unter Anzeige.
function renderCustomize({ settings }) {
  return `
    <div class="st-card">
      <div class="st-kicker">THEME</div>
      ${segment("skin", settings.skin ?? "modern", [["modern", "Modern"], ["sport", "Sport"]])}
      <div class="st-hint">Sport: Kalk-Weiß, jede Sportart in ihrer Farbe. Immer hell.</div>
    </div>`;
}

function uptime(bootAt, d) {
  const h = Math.floor((d - bootAt) / 3600000);
  return h >= 24 ? `${Math.floor(h / 24)} T ${String(h % 24).padStart(2, "0")} h` : `${h} h ${Math.floor((d - bootAt) / 60000) % 60} min`;
}

function renderSystem({ d, daemon, app }) {
  const rows = [
    ["Software", app?.commit ? app.commit.slice(0, 7) + (app.demo ? " · Demo" : "") : "–"],
    ["Läuft seit", app?.bootAt ? uptime(app.bootAt, d) : "–"],
    ["CPU", daemon?.cpuTemp != null ? `${Math.round(daemon.cpuTemp)} °C` : "–"]
  ];
  return `
    <div class="st-kicker st-modern">GERÄT</div>
    <div class="st-facts">${rows.map(([k, v]) => `<div class="st-fact"><span>${k}</span><span>${esc(v)}</span></div>`).join("")}</div>
    <div class="st-kicker st-modern">ADMIN-BEREICH</div>
    <div class="st-holds">${hold("admin-reset", "Passwort zurücksetzen", { warn: true })}</div>
    <div class="st-grow"></div>
    <div class="st-kicker st-modern">NEUSTART &amp; AUS</div>
    <div class="st-holds">${hold("reboot", "Neu starten", { big: true })}${hold("poweroff", "Herunterfahren", { big: true, warn: true })}</div>
    <div class="st-hint">Loslassen bricht ab – es passiert nichts.</div>`;
}

// notice: Fehlermeldung der letzten Aktion (z. B. Neustart verweigert), steht in der Kopfzeile.
export function renderSettings(p) {
  const body = ({ status: renderStatus, display: renderDisplay, customize: renderCustomize, system: renderSystem }[p.tab] ?? renderStatus)(p);
  return `
    <header class="st-head">
      <button type="button" class="st-back" data-close><span aria-hidden="true">←</span><span>Einstellungen</span></button>
      ${p.notice ? `<div class="st-notice">${esc(p.notice)}</div>` : ""}
      <div class="st-clock">${hhmm(p.d)}</div>
    </header>
    <div class="rule"></div>
    <div class="st-main">
      <nav class="st-tabs">
        ${TABS.map(([k, label]) => `<button type="button" data-tab="${k}"${k === p.tab ? ' aria-current="page"' : ""}>${label}</button>`).join("")}
        <div class="st-grow"></div>
        <div class="st-admin">Mehr im Admin<br>rahmen.local</div>
      </nav>
      <div class="st-divider"></div>
      <div class="st-body">${body}</div>
    </div>`;
}

// Vollbild nach Neustart/Herunterfahren, im Stil des Boot-Splash.
export function renderPower(action) {
  const reboot = action === "reboot";
  return `
    <div class="pw${reboot ? "" : " warn"}">
      <div class="pw-main"><div class="pw-bar"></div><div class="pw-title">${reboot ? "Startet<br>neu …" : "Fährt<br>herunter …"}</div></div>
      <div class="rule"></div>
      <div class="pw-foot">
        <span>${reboot ? "BITTE NICHT VOM STROM TRENNEN" : "STROM ERST TRENNEN, WENN DAS DISPLAY AUS IST"}</span>
        <span>${reboot ? "ZURÜCK IN CA. 40 S" : "CA. 15 S"}</span>
      </div>
      <div class="pw-track"><div style="animation-duration:${reboot ? 40 : 15}s"></div></div>
    </div>`;
}
