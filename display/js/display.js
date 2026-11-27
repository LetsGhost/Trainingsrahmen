import { adaptPlan } from "./adapter.js";
import { renderDay } from "./day.js";
import { renderRecovery } from "./recovery.js";
import { renderWeather } from "./weather.js";
import { renderSetup } from "./setup.js";
import { renderSettings, renderPower, renderUpdate, renderSensorLive, stepUp, stepDown, MIN_GATES, MAX_GATES, NIGHT_FROM, NIGHT_TO } from "./settings.js";
import { showSlideshow, stopSlideshow } from "./slideshow.js";
import * as motion from "./motion.js";
import { DOW_SHORT, DOW_LONG, MONTHS, pad, hhmm, esc, icon, dowIndex, hyphenate } from "./util.js";

const NIGHT_START = 22, NIGHT_END = 6;
const ACTIVITY_THROTTLE_MS = 2000;
const DAY_VIEW_MS = 60 * 1000;
// Ab so vielen Einheiten an einem Tag wird die Spalte kompakter, damit alles ohne Scrollen passt.
const DENSE_SESSIONS = 3;
// So lange steht 3C („Alles bereit“) nach der Einrichtung, bevor der Plan erscheint.
const SETUP_DONE_MS = 4000;
// So lange muss man WLAN ändern, Neustart und Herunterfahren gedrückt halten.
const HOLD_MS = 2000;

// Entwicklungs-Parameter: ?theme=dark|light, ?skin=modern|sport, ?now=2026-09-09T18:42 (verstellte Uhr) und
// ?day=0…6, ?day=recovery, ?day=weather bzw. ?day=settings (&tab=status|display|sensor|customize|system): Ansicht offen, ohne Rücksprung.
// Sie haben Vorrang vor den Einstellungen aus der Dev-Leiste.
const params = new URLSearchParams(location.search);
const urlTheme = params.get("theme");
const urlSkin = params.get("skin");
const urlClockOffset = params.get("now") ? new Date(params.get("now")).getTime() - Date.now() : null;
const urlDay = ["recovery", "weather", "settings"].includes(params.get("day")) ? params.get("day") : /^[0-6]$/.test(params.get("day") ?? "") ? Number(params.get("day")) : null;

const frame = document.getElementById("frame");
// daemon und sync: letzte Momentaufnahme aus /events (null, bis die Verbindung steht); dev: Dev-Leiste oder null.
// app: { commit, demo } des laufenden Daemons.
// openDay: Index des Tages in der Tagesansicht, "recovery" für die Erholungs-Ansicht, "weather" fürs Wetter-Vollbild, "settings" für die Einstellungen
// oder null. setupDoneUntil: bis dahin steht 3C.
// settingsTab, syncing, notice: Einstellungs-Screen. power: "reboot" | "poweroff", sobald ausgelöst (Vollbild bis zum Aus).
// sensorLive: letzter Wert aus /api/sensor, nur abgefragt, solange der Tab SENSOR offen ist.
const state = {
  plan: null, weather: null, daemon: null, sync: null, dev: null, app: null, openDay: urlDay, openSession: 0, setupDoneUntil: 0,
  settingsTab: params.get("tab") ?? "status", syncing: false, notice: null, power: null, sensorLive: null
};
const SENSOR_POLL_MS = 1000;

const now = () => new Date(Date.now() + (urlClockOffset ?? state.dev?.clockOffsetMs ?? 0));

function weekDates(d) {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dowIndex(d));
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - dowIndex(d));
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round((t - jan4) / 604800000 - 0.01);
}

// Einstellungen aus dem Admin-Bereich (über /events); fehlen sie, gilt alles als an.
const settings = () => state.daemon?.display ?? { theme: "auto", showWeather: true, showRecovery: true, brightness: "high", skin: "modern" };
const shownWeather = () => (settings().showWeather ? state.weather : null);
const shownRecovery = () => (settings().showRecovery ? state.plan?.recovery ?? [] : []);

// Die Einrichtung ist laut Vorlage immer dunkel. Vorrang: URL, Dev-Leiste, Admin-Einstellung, Nachtfenster.
function applyTheme(d, screen) {
  const h = d.getHours();
  const auto = screen === "setup" || h >= NIGHT_START || h < NIGHT_END ? "dark" : "light";
  const admin = settings().theme === "auto" ? null : settings().theme;
  const override = urlTheme ?? state.dev?.theme ?? admin;
  document.documentElement.dataset.theme = override === "dark" || override === "light" ? override : auto;
  document.documentElement.dataset.skin = urlSkin ?? settings().skin ?? "modern";
}

function renderHead(d, dates) {
  // Gezählt wird der Plan; ungeplante Garmin-Aktivitäten nicht.
  const count = state.plan ? state.plan.days.reduce((n, day) => n + day.sessions.filter(s => !s.unplanned).length, 0) : 0;
  const first = dates[0], last = dates[6];
  const range = `${pad(first.getDate())}.–${pad(last.getDate())}.${pad(last.getMonth() + 1)}.`;
  const w = shownWeather();
  const weather = w ? `
    <div class="weather">
      <div class="weather-text">
        <div class="weather-place">${esc(w.place.toUpperCase())} · ${esc(w.label.toUpperCase())}</div>
        <div class="weather-line">Gefühlt ${w.feels}° · Wind ${w.wind} km/h · ${w.precip} mm</div>
        <div class="weather-line">Nacht ${w.low}° · Sonne bis ${esc(w.sunset)}</div>
      </div>
      <div class="weather-now">${icon(w.icon)}<div class="weather-temp">${w.temp}°</div></div>
    </div>` : "";
  return `
    <header class="head">
      <div class="head-left">
        <div class="kicker">Woche ${isoWeek(d)} · ${range} · ${count} Einheiten${state.plan?.total ? ` · ${esc(state.plan.total)}` : ""}</div>
        <div class="clock-row">
          <div class="clock">${hhmm(d)}</div>
          <div class="date">
            <div class="date-dow">${DOW_LONG[dowIndex(d)]}</div>
            <div class="date-day">${pad(d.getDate())}. ${MONTHS[d.getMonth()]}</div>
          </div>
        </div>
      </div>
      ${weather}
    </header>`;
}

// Erledigt (Garmin): Häkchen statt Sport-Icon, die Sportart steht daneben. Ungeplant: gestrichelte Karte,
// Meta zeigt das Gemachte.
function renderSession(s) {
  const meta = [s.time, s.unplanned ? s.done : s.dur].filter(Boolean).join(" · ");
  const cls = (s.done ? " done" : "") + (s.unplanned ? " unplanned" : "");
  return `
    <div class="session${cls}" data-sport="${s.icon}"${s.min ? ` style="--min: ${s.min}"` : ""}>
      <div class="session-top">${icon(s.done ? "circle-check" : s.icon)}<span class="session-sport">${esc(s.sport)}</span></div>
      <div class="session-title">${esc(hyphenate(s.title))}</div>
      ${meta ? `<div class="session-meta">${esc(meta)}</div>` : ""}
    </div>`;
}

function renderWeek(d, dates) {
  const today = dowIndex(d);
  const days = state.plan ? state.plan.days : [];
  return `<section class="week">${dates.map((date, i) => {
    const sessions = days[i]?.sessions ?? [];
    const body = sessions.length
      ? sessions.map(renderSession).join("")
      : `<div class="rest">${icon("moon")}<div class="rest-label">RUHETAG</div></div>`;
    const cls = (i === today ? " today" : "") + (sessions.length >= DENSE_SESSIONS ? " dense" : "");
    return `
      <div class="day${cls}" data-day="${i}">
        <div class="day-head"><span class="day-dow">${DOW_SHORT[i]}</span><span class="day-date">${pad(date.getDate())}</span></div>
        <div class="day-bar"></div>
        ${state.plan ? body : ""}
      </div>`;
  }).join("")}</section>`;
}

function renderFoot() {
  const r = shownRecovery();
  const recovery = r.length
    ? `<div class="recovery">${r.map(x => `
        <div class="recovery-item">
          <div class="recovery-label">${esc(x.label)}</div>
          <div class="recovery-value">${esc(x.value)}</div>
        </div>`).join("")}</div>`
    : "";
  // Stand = letzter erfolgreicher Abruf des Plans durch den Daemon.
  const s = state.sync;
  const stand = s?.planAt ? hhmm(new Date(s.planAt)) : null;
  let sync;
  if (state.daemon?.setup === "OFFLINE") sync = `${icon("wifi-off")}<span>Offline${stand ? ` · Stand ${stand}` : ""}</span>`;
  else if (s?.planError) sync = `${icon("wifi-off")}<span>${esc(s.planError.message)}${stand ? ` · Stand ${stand}` : ""}</span>`;
  // Das Portal fragt nur das WLAN ab; ohne Zugang zum Trainingsplan bliebe hier sonst „Sync …“ stehen.
  else if (s?.sources && !s.sources.plan.configured && !s.sources.athletept.configured) sync = `${icon("wifi")}<span>Trainingsplan im Admin-Bereich eintragen</span>`;
  else sync = `${icon("wifi")}<span>${state.app?.demo ? "Demo · " : ""}Sync ${stand ?? "…"}</span>`;
  return `<footer class="foot">${recovery}<button type="button" class="sync" data-settings>${sync}</button></footer>`;
}

const isSetup = f => ["SETUP_HOTSPOT", "SETUP_ACCOUNT", "SETUP_ADMIN"].includes(f?.setup);
const setupDone = () => Date.now() < state.setupDoneUntil;

function screenFor(f) {
  if (state.power) return "power";
  if (state.app?.update) return "update";
  if (isSetup(f) || setupDone()) return "setup";
  if (f?.rest === "SLIDESHOW") return "slideshow";
  if (f?.rest === "AUS") return "off";
  if (state.openDay === "settings") return "settings";
  if (state.openDay === "weather") return shownWeather() ? "weather" : "plan";
  if (state.openDay === null || !state.plan) return "plan";
  return state.openDay === "recovery" ? "recovery" : "day";
}

let renderAfterMotion = false;
const flushRender = () => {
  if (!renderAfterMotion) return;
  renderAfterMotion = false;
  render();
};

function render() {
  // Ein neues innerHTML während des Haltens würde den Knopf samt Füllung ersetzen.
  if (holdTimer) return;
  // Mitten in einem Übergang neu zu zeichnen würde ihn zerreißen; danach wird nachgeholt.
  if (motion.busy()) {
    renderAfterMotion = true;
    return;
  }
  const d = now();
  const screen = screenFor(state.daemon);
  const from = frame.dataset.screen;
  // Slideshow kommt und geht weich, ob per Frist, Radar oder Tipp; nicht nach AUS, da ist das Licht ohnehin weg.
  if (from && from !== screen && screen !== "off" && (from === "slideshow" || screen === "slideshow")) {
    motion.fade(frame, null, () => draw(d, screen)).then(flushRender);
    return;
  }
  draw(d, screen);
}

// Wischbare Spalten der Tagesansicht. Ihre Position übersteht das Neuzeichnen (Uhr jede Minute, Daemon-Updates),
// solange derselbe Tag mit derselben Einheit offen bleibt.
const SCROLLERS = ".dv-main, .dv-side, .sd-main, .sd-side";
let shownView = null;

function draw(d, screen) {
  const view = `${screen}:${state.openDay}:${state.openSession}`;
  const scroll = view === shownView ? [...frame.querySelectorAll(SCROLLERS)].map(e => e.scrollTop) : [];
  shownView = view;
  try {
    drawScreen(d, screen);
  } finally {
    frame.querySelectorAll(SCROLLERS).forEach((e, i) => (e.scrollTop = scroll[i] ?? 0));
  }
}

function drawScreen(d, screen) {
  applyTheme(d, screen);
  frame.dataset.screen = screen;
  if (screen !== "slideshow") stopSlideshow();
  pollSensor(screen === "settings" && state.settingsTab === "sensor");
  if (screen === "power") frame.innerHTML = renderPower(state.power);
  else if (screen === "update") frame.innerHTML = renderUpdate(state.app.update);
  else if (screen === "setup") frame.innerHTML = renderSetup(state.daemon, setupDone());
  else if (screen === "settings") {
    frame.innerHTML = renderSettings({
      d, tab: state.settingsTab, daemon: state.daemon, sync: state.sync, app: state.app, syncing: state.syncing, notice: state.notice,
      settings: settings(), deadlines: state.daemon?.deadlines ?? { slideshowAfterMin: 5, offAfterMin: 30 },
      sensor: sensorSettings(), sensorLive: state.sensorLive, night: nightSettings()
    });
  }
  else if (screen === "slideshow") showSlideshow(frame, d);
  else if (screen === "off") frame.innerHTML = "";
  else if (screen === "weather") {
    frame.innerHTML = renderWeather({ d, w: shownWeather(), plan: state.plan, today: dowIndex(d), sport: document.documentElement.dataset.skin === "sport" });
  }
  else if (screen === "recovery") frame.innerHTML = renderRecovery({ d, r: state.plan.recoveryRaw });
  else if (screen === "day") {
    const index = state.openDay;
    frame.innerHTML = renderDay({
      d, index, date: weekDates(d)[index], today: dowIndex(d), plan: state.plan, weather: shownWeather(), recovery: shownRecovery(),
      session: state.openSession, sport: document.documentElement.dataset.skin === "sport"
    });
  } else {
    const dates = weekDates(d);
    frame.innerHTML = renderHead(d, dates) + `<div class="rule"></div>` + renderWeek(d, dates) + `<div class="rule"></div>` + renderFoot();
  }
}

// null, solange der Daemon noch keinen Stand hat (404).
async function getJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Plan und Wetter vom Daemon laden; abgerufen und gecacht werden sie dort.
async function load() {
  const [plan, weather] = await Promise.all([getJson("/api/plan"), getJson("/api/weather")]);
  state.plan = plan ? adaptPlan(plan) : null;
  state.weather = weather;
  render();
}

// Die Uhr ist das Einzige, was sich ohne Sync ändert: ein Render pro Minute, auf die volle Minute ausgerichtet.
function scheduleTick() {
  setTimeout(() => { render(); scheduleTick(); }, 60000 - (now().getTime() % 60000) + 50);
}

// Zustand vom Daemon. EventSource verbindet sich nach einem Abbruch selbst neu.
function listen() {
  const events = new EventSource("/events");
  events.onmessage = e => {
    const msg = JSON.parse(e.data);
    // Nach einem Update läuft ein anderer Commit: Seite neu laden, damit auch das Display den neuen Stand hat.
    if (state.app && msg.app.commit !== state.app.commit) return location.reload();
    state.app = msg.app;
    const newData = msg.sync.planAt !== state.sync?.planAt || msg.sync.weatherAt !== state.sync?.weatherAt;
    const becameReady = msg.frame.setup === "READY" && state.daemon?.setup !== "READY";
    if (becameReady && isSetup(state.daemon)) {
      state.setupDoneUntil = Date.now() + SETUP_DONE_MS;
      setTimeout(render, SETUP_DONE_MS + 50);
    }
    state.daemon = msg.frame;
    state.sync = msg.sync;
    state.dev = msg.dev;
    if (msg.frame.rest !== "AKTIV" || isSetup(msg.frame)) closeDay(false);
    if (newData) load();
    else render();
  };
}

// Touch meldet Aktivität an den Daemon. Außerhalb von AKTIV weckt der erste Tipp nur und löst nichts aus.
let lastActivity = 0;
let swallowClick = false;
document.addEventListener("pointerdown", e => {
  const resting = state.daemon && state.daemon.rest !== "AKTIV";
  if (resting) {
    e.preventDefault();
    e.stopPropagation();
    swallowClick = true;
  }
  if (resting || Date.now() - lastActivity > ACTIVITY_THROTTLE_MS) {
    lastActivity = Date.now();
    fetch("/api/activity", { method: "POST" }).catch(() => {});
  }
}, true);
document.addEventListener("click", e => {
  if (!swallowClick) return;
  swallowClick = false;
  e.preventDefault();
  e.stopPropagation();
}, true);

// Tagesansicht: Tipp auf einen Tag öffnet ihn, Tipp auf die Erholungswerte die Erholungs-Ansicht, aufs Wetter das Wetter-Vollbild;
// ein weiterer Tipp oder 60 s führen zurück zur Woche.
let dayTimer = null;

// session: welche Einheit des Tages groß steht (Tipp auf „Weitere Einheiten“); startet die 60 s neu.
function openDay(index, session = 0) {
  state.openDay = index;
  state.openSession = session;
  restartDayTimer();
  render();
}

function restartDayTimer() {
  clearTimeout(dayTimer);
  dayTimer = setTimeout(() => closeDay(true, true), DAY_VIEW_MS);
}

// Wischen zählt als Berührung: die 60 s bis zum Rücksprung neu starten. Nicht über „scroll“, das feuert auch, wenn
// draw() die Position nach dem Neuzeichnen zurücksetzt; dann käme der Rücksprung nie.
["touchmove", "wheel"].forEach(type => frame.addEventListener(type, () => {
  if (state.openDay !== null) restartDayTimer();
}, { passive: true }));

// Wovon aus der Woche ein Screen aufgeht und wohin er zurückschrumpft; shared fliegt als geteiltes Element nach target.
function sourceFor(open) {
  if (open === "weather") return { box: ".weather", shared: ".weather-temp", target: ".wv-temp, .sw-temp" };
  if (open === "recovery") return { box: ".recovery-item:first-child", shared: ".recovery-item:first-child .recovery-value", target: ".rv-big" };
  return { box: `[data-day="${open}"]` };
}

async function animate(transition, open, apply) {
  if (motion.busy()) return apply();
  await transition(frame, sourceFor(open), apply);
  flushRender();
}

function openAnimated(index) {
  animate(index === "settings" ? motion.sheetUp : motion.open, index, () => openDay(index));
}

// auto: nach 60 s ohne Tipp langsam überblenden statt zur Quelle zurückzuschrumpfen.
function closeDay(rerender = true, auto = false) {
  clearTimeout(dayTimer);
  if (state.openDay === null) return;
  const open = state.openDay;
  const apply = () => {
    state.openDay = null;
    if (rerender) render();
  };
  if (!rerender || !["day", "recovery", "weather", "settings"].includes(frame.dataset.screen)) return apply();
  animate(auto ? motion.fade : open === "settings" ? motion.sheetDown : motion.close, open, apply);
}

// --- Einstellungs-Screen ---

// Aktion am Daemon; ein Fehler steht danach in der Kopfzeile.
async function frameAction(name, body = {}) {
  try {
    const res = await fetch(`/api/frame/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Fehler ${res.status}`);
    state.notice = null;
    return true;
  } catch (err) {
    state.notice = err.message;
    return false;
  }
}

async function syncNow() {
  state.syncing = true;
  render();
  await frameAction("sync");
  state.syncing = false;
  render();
}

async function power(action) {
  state.power = action;
  render();
  if (!(await frameAction(action))) {
    state.power = null;
    render();
  }
}

const HOLD_ACTIONS = {
  "wifi-reset": () => frameAction("wifi-reset").then(render),
  "admin-reset": () => frameAction("admin-reset").then(render),
  reboot: () => power("reboot"), poweroff: () => power("poweroff") };

// Halten: Füllung per CSS-Übergang; nach 2 s löst die Aktion aus, Loslassen vorher bricht ab.
let holdTimer = null;
let holdButton = null;
frame.addEventListener("pointerdown", e => {
  const button = e.target.closest("[data-hold]");
  // Ein zweiter Finger startet kein zweites Halten; sonst feuerten Neustart und Herunterfahren beide.
  if (!button || holdButton || frame.dataset.screen !== "settings") return;
  holdButton = button;
  button.classList.add("holding");
  holdTimer = setTimeout(() => {
    holdTimer = null;
    HOLD_ACTIONS[button.dataset.hold]();
  }, HOLD_MS);
});
function cancelHold() {
  if (!holdButton) return;
  holdButton.classList.remove("holding");
  holdButton = null;
  if (!holdTimer) return;
  clearTimeout(holdTimer);
  holdTimer = null;
  render();
}
["pointerup", "pointercancel", "pointerleave"].forEach(type => frame.addEventListener(type, cancelHold));
// Finger rutscht vom Knopf: Halten abbrechen (Touch-Pointer sind implizit gefangen, daher per Koordinate prüfen).
frame.addEventListener("pointermove", e => {
  if (holdButton && document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-hold]") !== holdButton) cancelHold();
});
// Long-Press öffnet in Chromium sonst das Kontextmenü und bricht das Halten ab.
frame.addEventListener("contextmenu", e => e.preventDefault());

const sensorSettings = () => state.daemon?.sensor ?? { gates: 6, sensitivity: "mid" };
const nightSettings = () => state.daemon?.night ?? { from: 22, to: 7 };

// Nur das Live-Feld neu schreiben: ein ganzes render() pro Sekunde wäre auf dem Pi unnötig teuer.
let sensorTimer = null;
function pollSensor(on) {
  if (!on) {
    clearInterval(sensorTimer);
    sensorTimer = null;
    state.sensorLive = null;
    return;
  }
  if (sensorTimer) return;
  const tick = async () => {
    state.sensorLive = (await getJson("/api/sensor")) ?? { online: false };
    const el = document.getElementById("st-live");
    if (el && sensorTimer) el.innerHTML = renderSensorLive(state.sensorLive);
  };
  sensorTimer = setInterval(tick, SENSOR_POLL_MS);
  tick();
}

function changeSetting(el) {
  if (el.dataset.step === "nightFrom" || el.dataset.step === "nightTo") {
    const night = { ...nightSettings() };
    const [key, steps] = el.dataset.step === "nightFrom" ? ["from", NIGHT_FROM] : ["to", NIGHT_TO];
    night[key] = steps[Math.min(steps.length - 1, Math.max(0, steps.indexOf(night[key]) + Number(el.dataset.dir)))];
    return frameAction("settings", { night }).then(render);
  }
  if (el.dataset.set === "sensitivity" || el.dataset.step === "gates") {
    const sensor = { ...sensorSettings() };
    if (el.dataset.set) sensor.sensitivity = el.dataset.value;
    else sensor.gates = Math.min(MAX_GATES, Math.max(MIN_GATES, sensor.gates + Number(el.dataset.dir)));
    return frameAction("settings", { sensor }).then(render);
  }
  if (el.dataset.set) {
    return frameAction("settings", { display: { ...settings(), [el.dataset.set]: el.dataset.value } }).then(render);
  }
  const deadlines = { ...state.daemon.deadlines };
  const key = el.dataset.step;
  deadlines[key] = (el.dataset.dir === "1" ? stepUp : stepDown)(deadlines[key]) ?? deadlines[key];
  return frameAction("settings", { deadlines }).then(render);
}

function settingsClick(e) {
  openDay("settings");
  if (e.target.closest("[data-close]")) return closeDay();
  const el = e.target.closest("[data-tab], [data-action], [data-set], [data-step]");
  if (!el || el.disabled) return;
  if (el.dataset.tab) {
    state.settingsTab = el.dataset.tab;
    render();
  } else if (el.dataset.action === "sync") syncNow();
  else changeSetting(el);
}

frame.addEventListener("click", e => {
  if (motion.busy()) return;
  if (frame.dataset.screen === "settings") return settingsClick(e);
  const session = e.target.closest("[data-session]");
  if (frame.dataset.screen === "day" && session) return openDay(state.openDay, Number(session.dataset.session));
  if (["day", "recovery", "weather"].includes(frame.dataset.screen)) return closeDay();
  if (frame.dataset.screen !== "plan") return;
  const day = e.target.closest("[data-day]");
  if (e.target.closest("[data-settings]")) {
    state.settingsTab = "status";
    state.notice = null;
    openAnimated("settings");
  } else if (day) openAnimated(Number(day.dataset.day));
  else if (e.target.closest(".recovery")) openAnimated("recovery");
  else if (e.target.closest(".weather")) openAnimated("weather");
});

render();
listen();
scheduleTick();
