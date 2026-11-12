// Erholungs-Ansicht (Tipp auf die Fußleiste): links Erholungswert mit Einschätzung und Body Battery,
// rechts Schlafphasen, HRV mit 7-Tage-Verlauf und Ruhepuls. r ist recovery roh aus dem Plan (daemon/garmin.js);
// was fehlt, fällt weg.
import { formatHours } from "./adapter.js";
import { hhmm, esc, icon } from "./util.js";

const HRV_STATUS = { BALANCED: "ausgeglichen", UNBALANCED: "unausgeglichen", LOW: "niedrig", POOR: "schlecht" };

const has = v => Number.isFinite(v);
const dur = min => (min >= 60 ? formatHours(min) : `${min} min`);

// Einschätzung aus dem Erholungswert (0–100), ergänzt um Schlafdauer und HRV-Status.
// shortcut: eigene Texte statt Garmins Schlaf-Feedback, weil die Personal API dafür (wenn überhaupt) nur Codes liefert.
const LEVELS = [
  [75, "Gut erholt", "Du bist voll erholt und kannst heute mit voller Intensität trainieren."],
  [50, "Teilweise erholt", "Du bist ausreichend erholt. Intensive Einheiten gehen, aber hör auf deinen Körper."],
  [25, "Wenig erholt", "Deine Erholung ist eingeschränkt. Heute besser locker oder kürzer trainieren."],
  [0, "Erschöpft", "Dein Körper braucht Ruhe. Gönn dir heute einen Ruhetag oder nur leichte Bewegung."]
];

function assessment(r) {
  const [, title, text] = LEVELS.find(([min]) => r.score >= min);
  const sleep = has(r.sleepMinutes) ? (r.sleepMinutes >= 420 ? "Du hast gut geschlafen. " : "Du hast eher kurz geschlafen. ") : "";
  const hrv = ["LOW", "POOR", "UNBALANCED"].includes(r.hrvStatus) ? " Deine HRV liegt außerhalb deines Normalbereichs." : "";
  return { title, text: sleep + text + hrv };
}

// score ist mit Garmin die Body Battery beim Aufwachen (dann gibt es auch batteryNow); sonst der Wert von Sport-Analytics.
function renderScore(r) {
  if (!has(r.score)) return `<div class="rv-score"><div class="dv-heading">ERHOLUNG</div><div class="rv-empty">Keine Erholungsdaten</div></div>`;
  const { title, text } = assessment(r);
  return `
    <div class="rv-score">
      <div class="dv-heading">ERHOLUNG</div>
      <div class="rv-big">${r.score}</div>
      <div class="rv-verdict">${title}</div>
      <p class="rv-text">${esc(text)}</p>
    </div>`;
}

function renderBattery(r) {
  if (!has(r.batteryNow)) return "";
  return `
    <div class="rv-battery">
      <div class="dv-label">BODY BATTERY</div>
      <div class="rv-row-value">${r.batteryNow}${has(r.score) ? `<span class="rv-unit">morgens ${r.score}</span>` : ""}</div>
    </div>`;
}

function renderSleep(r) {
  const phases = [["TIEF", r.sleepDeep, "deep"], ["LEICHT", r.sleepLight, "light"], ["REM", r.sleepRem, "rem"], ["WACH", r.sleepAwake, "awake"]]
    .filter(([, min]) => has(min) && min > 0);
  if (!has(r.sleepMinutes) && !phases.length) return "";
  const sum = phases.reduce((n, [, min]) => n + min, 0);
  return `
    <div class="rv-cell">
      <div class="rv-head"><div class="dv-heading">SCHLAF</div>${has(r.sleepMinutes) ? `<div class="rv-value">${esc(dur(r.sleepMinutes))}</div>` : ""}</div>
      ${phases.length ? `
        <div class="rv-sleep-bar">${phases.map(([, min, cls]) => `<div class="rv-${cls}" style="flex: ${min / sum}"></div>`).join("")}</div>
        <div class="rv-legend">${phases.map(([label, min, cls]) => `
          <div class="rv-legend-item"><span class="rv-swatch rv-${cls}"></span><span class="dv-label">${label}</span><span class="rv-legend-value">${esc(dur(min))}</span></div>`).join("")}
        </div>` : ""}
    </div>`;
}

// Balken über dem Bereich ab 75 % des kleinsten Werts, damit Unterschiede von wenigen ms sichtbar bleiben.
// Eine Nacht ohne Wert erscheint als gestrichelter Platzhalter.
function renderHrvChart(history, weekly) {
  const values = history.map(h => h.hrv).filter(has);
  const lo = Math.floor(Math.min(...values, weekly ?? Infinity) * 0.75);
  const hi = Math.max(...values, weekly ?? 0);
  const pct = v => ((v - lo) / (hi - lo || 1)) * 100;
  return `
    <div class="rv-bars">
      ${history.map((h, i) => has(h.hrv)
        ? `<div class="rv-bar${i === history.length - 1 ? " today" : ""}" style="height: ${pct(h.hrv)}%"></div>`
        : `<div class="rv-bar missing"></div>`).join("")}
      ${has(weekly) ? `<div class="rv-avg" style="bottom: ${pct(weekly)}%"></div>` : ""}
    </div>`;
}

function renderHrv(r) {
  const history = r.hrvHistory?.some(h => has(h.hrv)) ? r.hrvHistory : null;
  if (!has(r.hrv) && !history) return "";
  const note = [has(r.hrvWeekly) && `Ø ${r.hrvWeekly}`, HRV_STATUS[r.hrvStatus]].filter(Boolean).join(" · ");
  return `
    <div class="rv-cell rv-hrv">
      <div class="rv-hrv-text">
        <div class="dv-heading">HRV</div>
        ${has(r.hrv) ? `<div class="rv-value">${r.hrv}<span class="rv-unit">ms</span></div>` : ""}
        ${note ? `<div class="rv-note">${note}</div>` : ""}
      </div>
      ${history ? renderHrvChart(history, r.hrvWeekly) : ""}
    </div>`;
}

function renderRestingHr(r) {
  if (!has(r.restingHr)) return "";
  const diff = has(r.restingHrWeekly) ? r.restingHr - r.restingHrWeekly : null;
  return `
    <div class="rv-cell rv-hr">
      <div>
        <div class="dv-heading">RUHEPULS</div>
        ${diff !== null ? `<div class="rv-note">${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(diff)} ggü. Ø ${r.restingHrWeekly}</div>` : ""}
      </div>
      <div class="rv-value">${r.restingHr}<span class="rv-unit">bpm</span></div>
    </div>`;
}

export function renderRecovery({ d, r }) {
  return `
    <header class="rv-top">
      <div class="rv-back">${icon("arrow-left")}</div>
      <div class="rv-title">Erholung &amp; Schlaf</div>
      <div class="dv-clock">${hhmm(d)}</div>
    </header>
    <section class="recoveryview">
      <div class="rv-main">
        ${renderScore(r)}
        ${renderBattery(r)}
      </div>
      <div class="rv-side">
        ${renderSleep(r)}
        ${renderHrv(r)}
        ${renderRestingHr(r)}
      </div>
    </section>`;
}
