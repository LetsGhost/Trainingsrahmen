// Erholungs-Ansicht (Tipp auf die Fußleiste): links Body Battery und Schlafphasen, rechts HRV mit 7-Tage-Verlauf
// und Ruhepuls. r ist recovery roh aus dem Plan (daemon/garmin.js); was fehlt, fällt weg.
import { formatHours } from "./adapter.js";
import { DOW_SHORT, hhmm, esc, dowIndex } from "./util.js";

const HRV_STATUS = {
  BALANCED: ["AUSGEGLICHEN", "ok"],
  UNBALANCED: ["UNAUSGEGLICHEN", "warn"],
  LOW: ["NIEDRIG", "bad"],
  POOR: ["SCHLECHT", "bad"]
};

const has = v => Number.isFinite(v);
const dur = min => (min >= 60 ? formatHours(min) : `${min} min`);
const dowOf = date => DOW_SHORT[dowIndex(new Date(`${date}T12:00`))];

// score ist nur mit Garmin die Body Battery (dann gibt es auch batteryNow); sonst der Wert von Sport-Analytics.
function renderBattery(r) {
  if (!has(r.score) && !has(r.batteryNow)) return "";
  const garmin = has(r.batteryNow);
  return `
    <div class="rv-block">
      <div class="dv-label">ERHOLUNG</div>
      <div class="rv-big-row">
        ${has(r.score) ? `<div class="rv-big">${r.score}</div>${garmin ? `<div class="rv-note">Body Battery<br>beim Aufwachen</div>` : ""}` : ""}
        ${has(r.batteryNow) ? `<div class="rv-now"><div class="dv-label">JETZT</div><div class="rv-now-value">${r.batteryNow}</div></div>` : ""}
      </div>
    </div>`;
}

function renderSleep(r) {
  const phases = [["TIEF", r.sleepDeep, "deep"], ["LEICHT", r.sleepLight, "light"], ["REM", r.sleepRem, "rem"], ["WACH", r.sleepAwake, "awake"]]
    .filter(([, min]) => has(min) && min > 0);
  if (!has(r.sleepMinutes) && !phases.length) return "";
  const sum = phases.reduce((n, [, min]) => n + min, 0);
  return `
    <div class="rv-block">
      <div class="rv-head"><div class="dv-label">SCHLAF</div>${has(r.sleepMinutes) ? `<div class="rv-value">${esc(dur(r.sleepMinutes))}</div>` : ""}</div>
      ${phases.length ? `
        <div class="rv-sleep-bar">${phases.map(([, min, cls]) => `<div class="rv-${cls}" style="flex: ${min / sum}"></div>`).join("")}</div>
        <div class="rv-legend">${phases.map(([label, min, cls]) => `
          <div class="rv-legend-item"><span class="rv-swatch rv-${cls}"></span><span class="dv-label">${label}</span><span class="rv-legend-value">${esc(dur(min))}</span></div>`).join("")}
        </div>` : ""}
    </div>`;
}

// Balken über dem Bereich ab 75 % des kleinsten Werts, damit Unterschiede von wenigen ms sichtbar bleiben.
function renderHrvChart(history, weekly) {
  const values = history.map(h => h.hrv).filter(has);
  if (!values.length) return "";
  const lo = Math.floor(Math.min(...values, weekly ?? Infinity) * 0.75);
  const hi = Math.max(...values, weekly ?? 0);
  const pct = v => ((v - lo) / (hi - lo || 1)) * 100;
  return `
    <div class="rv-chart">
      <div class="rv-bars">
        ${history.map((h, i) => `<div class="rv-bar${i === history.length - 1 ? " today" : ""}" style="height: ${has(h.hrv) ? pct(h.hrv) : 0}%"></div>`).join("")}
        ${has(weekly) ? `<div class="rv-avg" style="bottom: ${pct(weekly)}%"></div>` : ""}
      </div>
      <div class="rv-days">${history.map((h, i) => `<div class="${i === history.length - 1 ? "today" : ""}">${dowOf(h.date)}</div>`).join("")}</div>
    </div>`;
}

function renderHrv(r) {
  const history = r.hrvHistory?.some(h => has(h.hrv)) ? r.hrvHistory : null;
  if (!has(r.hrv) && !history) return "";
  const [label, level] = HRV_STATUS[r.hrvStatus] ?? [];
  return `
    <div class="rv-side-block">
      <div class="dv-heading">HRV · 7 TAGE</div>
      <div class="rv-head">
        ${has(r.hrv) ? `<div class="rv-value">${r.hrv} ms</div>` : ""}
        ${has(r.hrvWeekly) ? `<div class="rv-note">Ø ${r.hrvWeekly} ms</div>` : ""}
      </div>
      ${label ? `<div class="rv-status ${level}">${label}</div>` : ""}
      ${history ? renderHrvChart(history, r.hrvWeekly) : ""}
    </div>`;
}

export function renderRecovery({ d, r }) {
  return `
    <section class="dayview">
      <div class="dv-main">
        <div class="dv-top">
          <div class="kicker">HEUTE · ERHOLUNG</div>
          <div class="dv-clock">${hhmm(d)}</div>
        </div>
        <div class="dv-rule"></div>
        ${renderBattery(r)}
        ${renderSleep(r)}
      </div>
      <div class="dv-divider"></div>
      <div class="dv-side">
        ${renderHrv(r)}
        ${has(r.restingHr) ? `
          <div class="rv-side-block">
            <div class="dv-heading">RUHEPULS</div>
            <div class="rv-value">${r.restingHr} <span class="rv-note">bpm</span></div>
          </div>` : ""}
      </div>
    </section>`;
}
