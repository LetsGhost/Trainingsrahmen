import { adaptPlan } from "./adapter.js";

const DOW_SHORT = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"];
const DOW_LONG = ["MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG", "SONNTAG"];
const MONTHS = ["JANUAR", "FEBRUAR", "MÄRZ", "APRIL", "MAI", "JUNI", "JULI", "AUGUST", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DEZEMBER"];
const NIGHT_START = 22, NIGHT_END = 6;
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

// Entwicklungs-Parameter: ?theme=dark|light und ?now=2026-09-09T18:42 (verstellte Uhr).
const params = new URLSearchParams(location.search);
const themeOverride = params.get("theme");
const clockOffset = params.get("now") ? new Date(params.get("now")).getTime() - Date.now() : 0;

const frame = document.getElementById("frame");
const state = { plan: null, weather: null, lastSync: null, online: true };

const now = () => new Date(Date.now() + clockOffset);
const pad = n => String(n).padStart(2, "0");
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = name => `<svg class="icon" viewBox="0 0 24 24"><use href="assets/icons.svg#i-${name}"></use></svg>`;

// Montag = 0 … Sonntag = 6
const dowIndex = d => (d.getDay() + 6) % 7;

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
  document.documentElement.dataset.theme = themeOverride === "dark" || themeOverride === "light" ? themeOverride : auto;
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
      <div class="session-title">${esc(s.title)}</div>
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
    return `
      <div class="day${i === today ? " today" : ""}">
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
  const sync = state.online
    ? `${icon("wifi")}<span>Sync ${state.lastSync ? hhmm(state.lastSync) : "…"}</span>`
    : `${icon("wifi-off")}<span>Offline${state.lastSync ? ` · Stand ${hhmm(state.lastSync)}` : ""}</span>`;
  return `<footer class="foot">${recovery}<div class="sync">${sync}</div></footer>`;
}

function render() {
  const d = now();
  const dates = weekDates(d);
  applyTheme(d);
  frame.innerHTML = renderHead(d, dates) + `<div class="rule"></div>` + renderWeek(d, dates) + `<div class="rule"></div>` + renderFoot();
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

render();
sync();
setInterval(sync, SYNC_INTERVAL_MS);
scheduleTick();
