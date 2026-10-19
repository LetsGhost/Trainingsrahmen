import { adaptPlan } from "./adapter.js";
import { renderDay } from "./day.js";
import { DOW_SHORT, DOW_LONG, MONTHS, pad, hhmm, esc, icon, dowIndex, hyphenate } from "./util.js";

const NIGHT_START = 22, NIGHT_END = 6;
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 2000;
const DAY_VIEW_MS = 60 * 1000;
// Ab so vielen Einheiten an einem Tag wird die Spalte kompakter, damit alles ohne Scrollen passt.
const DENSE_SESSIONS = 3;

// Entwicklungs-Parameter: ?theme=dark|light, ?now=2026-09-09T18:42 (verstellte Uhr) und
// ?day=0…6 (Tagesansicht offen, ohne Rücksprung). Sie haben Vorrang vor den Einstellungen aus der Dev-Leiste.
const params = new URLSearchParams(location.search);
const urlTheme = params.get("theme");
const urlClockOffset = params.get("now") ? new Date(params.get("now")).getTime() - Date.now() : null;
const urlDay = /^[0-6]$/.test(params.get("day") ?? "") ? Number(params.get("day")) : null;

const frame = document.getElementById("frame");
// daemon: letzte Momentaufnahme aus /events (null, bis die Verbindung steht); dev: Dev-Leiste oder null.
// openDay: Index des Tages in der Tagesansicht oder null.
const state = { plan: null, weather: null, lastSync: null, online: true, daemon: null, dev: null, openDay: urlDay };

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

function applyTheme(d) {
  const h = d.getHours();
  const auto = h >= NIGHT_START || h < NIGHT_END ? "dark" : "light";
  const override = urlTheme ?? state.dev?.theme;
  document.documentElement.dataset.theme = override === "dark" || override === "light" ? override : auto;
}

function renderHead(d, dates) {
  const count = state.plan ? state.plan.days.reduce((n, day) => n + day.sessions.length, 0) : 0;
  const first = dates[0], last = dates[6];
  const range = `${pad(first.getDate())}.–${pad(last.getDate())}.${pad(last.getMonth() + 1)}.`;
  const w = state.weather;
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
        <div class="kicker">WOCHE ${isoWeek(d)} · ${range} · ${count} EINHEITEN${state.plan?.total ? ` · ${esc(state.plan.total.toUpperCase())}` : ""}</div>
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

function renderSession(s) {
  const meta = [s.time, s.dur].filter(Boolean).join(" · ");
  return `
    <div class="session">
      <div class="session-top">${icon(s.icon)}<span class="session-sport">${esc(s.sport)}</span></div>
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
  const r = state.plan?.recovery;
  const recovery = r?.length
    ? `<div class="recovery">${r.map(x => `
        <div class="recovery-item">
          <div class="recovery-label">${esc(x.label)}</div>
          <div class="recovery-value">${esc(x.value)}</div>
        </div>`).join("")}</div>`
    : "";
  const online = state.online && state.daemon?.setup !== "OFFLINE";
  const sync = online
    ? `${icon("wifi")}<span>Sync ${state.lastSync ? hhmm(state.lastSync) : "…"}</span>`
    : `${icon("wifi-off")}<span>Offline${state.lastSync ? ` · Stand ${hhmm(state.lastSync)}` : ""}</span>`;
  return `<footer class="foot">${recovery}<div class="sync">${sync}</div></footer>`;
}

// Platzhalter, bis Phase 5 die Screens 3A–3C bringt.
function renderSetup(f) {
  let line;
  if (f.connecting) line = "Verbinde …";
  else if (f.error) line = `Fehler: ${esc(f.error.message)}`;
  else if (f.setup === "SETUP_ACCOUNT") line = "Handy verbunden · Daten im Portal eintragen";
  else line = "Handy mit dem WLAN des Rahmens verbinden";
  const hotspot = f.hotspot
    ? `<div class="notice-line">WLAN ${esc(f.hotspot.ssid)} · Passwort ${esc(f.hotspot.password)}</div>`
    : "";
  return `
    <section class="notice">
      <div class="kicker">EINRICHTUNG</div>
      <div class="notice-title">${line}</div>
      ${hotspot}
    </section>`;
}

// Platzhalter, bis Phase 7 Bilder hochladen kann.
function renderSlideshow(d) {
  return `
    <section class="notice">
      <div class="kicker">SLIDESHOW</div>
      <div class="clock">${hhmm(d)}</div>
    </section>`;
}

function screenFor(f) {
  if (f?.setup === "SETUP_HOTSPOT" || f?.setup === "SETUP_ACCOUNT") return "setup";
  if (f?.rest === "SLIDESHOW") return "slideshow";
  if (f?.rest === "AUS") return "off";
  return state.openDay !== null && state.plan ? "day" : "plan";
}

function render() {
  const d = now();
  applyTheme(d);
  const screen = screenFor(state.daemon);
  frame.dataset.screen = screen;
  if (screen === "setup") frame.innerHTML = renderSetup(state.daemon);
  else if (screen === "slideshow") frame.innerHTML = renderSlideshow(d);
  else if (screen === "off") frame.innerHTML = "";
  else if (screen === "day") {
    const index = state.openDay;
    frame.innerHTML = renderDay({
      d, index, date: weekDates(d)[index], today: dowIndex(d), plan: state.plan, weather: state.weather
    });
  } else {
    const dates = weekDates(d);
    frame.innerHTML = renderHead(d, dates) + `<div class="rule"></div>` + renderWeek(d, dates) + `<div class="rule"></div>` + renderFoot();
  }
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function sync() {
  try {
    const [plan, weather] = await Promise.all([getJson("/api/plan"), getJson("/api/weather").catch(() => null)]);
    state.plan = adaptPlan(plan);
    state.weather = weather;
    state.lastSync = now();
    state.online = true;
  } catch (err) {
    console.error(err);
    state.online = false;
  }
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
    const planChanged = state.dev && msg.dev && msg.dev.plan !== state.dev.plan;
    const becameReady = msg.frame.setup === "READY" && state.daemon?.setup !== "READY";
    state.daemon = msg.frame;
    state.dev = msg.dev;
    if (msg.frame.rest !== "AKTIV") closeDay(false);
    if (planChanged || becameReady) sync();
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

// Tagesansicht: Tipp auf einen Tag öffnet ihn; ein weiterer Tipp oder 60 s führen zurück zur Woche.
let dayTimer = null;

function openDay(index) {
  state.openDay = index;
  clearTimeout(dayTimer);
  dayTimer = setTimeout(closeDay, DAY_VIEW_MS);
  render();
}

function closeDay(rerender = true) {
  clearTimeout(dayTimer);
  if (state.openDay === null) return;
  state.openDay = null;
  if (rerender) render();
}

frame.addEventListener("click", e => {
  if (frame.dataset.screen === "day") return closeDay();
  const day = e.target.closest("[data-day]");
  if (frame.dataset.screen === "plan" && day && state.plan) openDay(Number(day.dataset.day));
});

render();
listen();
sync();
setInterval(sync, SYNC_INTERVAL_MS);
scheduleTick();
