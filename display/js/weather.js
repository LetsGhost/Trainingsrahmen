// Wetter-Vollbild (Tipp aufs Wetter im Wochenplan): links jetzt mit Kennzahlen und Satz zur nächsten Einheit,
// rechts Regen der nächsten 12 Stunden und die Woche. w ist das Modell aus daemon/weather.js.
import { renderSportWeather } from "./weather-sport.js";
import { DOW_SHORT, DOW_LONG, pad, hhmm, esc, icon, dowIndex } from "./util.js";

// Nächste noch offene Einheit heute mit Uhrzeit, die in den 12 Stunden von w.hours liegt; sonst null.
export function nextSession(plan, today, d) {
  const sessions = plan?.days[today]?.sessions ?? [];
  return sessions.find(s => s.time && !s.done && Number(s.time.slice(0, 2)) >= d.getHours()) ?? null;
}

// Ein Satz, was das Wetter für die Einheit heißt, z. B. „Ab 17 Uhr trocken, 7° – draußen gut machbar.“; null ohne Daten.
export function trainingHint(w, session) {
  const hours = w?.hours ?? [];
  const at = session && hours.findIndex(h => h.hour === Number(session.time.slice(0, 2)));
  if (!session || at < 0) return null;
  const h = hours[at];
  if (h.precip > 0) return `Um ${h.hour} Uhr Regen (${String(h.precip).replace(".", ",")} mm), ${h.temp}° – Regenjacke oder drinnen.`;
  const lastWet = hours.slice(0, at).map(x => x.precip > 0).lastIndexOf(true);
  const from = lastWet < 0 ? "Trocken" : `Ab ${hours[lastWet + 1].hour} Uhr trocken`;
  return `${from}, ${h.temp}° – draußen gut machbar.`;
}

const has = v => Number.isFinite(v);
const mm = v => String(v).replace(".", ",");

function renderStat(label, value, note) {
  if (value == null) return "";
  return `
    <div class="wv-stat">
      <span class="wv-label">${label}</span>
      <span class="wv-stat-value">${esc(value)}</span>
      ${note ? `<span class="wv-note">${esc(note)}</span>` : ""}
    </div>`;
}

function renderNow(w, session, hint) {
  const day = w.forecast?.[0];
  const range = day ? ` · ${day.hi}° / ${day.lo}°` : has(w.low) ? ` · Nacht ${w.low}°` : "";
  return `
    <div class="wv-now">
      <div class="wv-heading">JETZT</div>
      <div class="wv-temp-row"><div class="wv-temp">${has(w.temp) ? `${w.temp}°` : "–"}</div>${w.icon ? icon(w.icon) : ""}</div>
      <div class="wv-cond">${esc(w.label ?? "")}</div>
      ${has(w.feels) ? `<div class="wv-feels">Gefühlt ${w.feels}°${range}</div>` : ""}
      <div class="wv-stats">
        ${renderStat("WIND", has(w.wind) ? `${w.wind} km/h` : null, w.windDir && `aus ${w.windDir}`)}
        ${renderStat("REGEN HEUTE", has(w.precip) ? `${mm(w.precip)} mm` : null)}
        ${renderStat("LUFTFEUCHTE", has(w.humidity) ? `${w.humidity} %` : null)}
        ${renderStat("SONNE", w.sunrise, w.sunset && `unter ${w.sunset}`)}
      </div>
      <div class="wv-spacer"></div>
      ${hint ? `
        <div class="wv-hint">
          <span class="wv-hint-head">${esc((session.sport || session.title || "Training").toUpperCase())} · ${esc(session.time)}</span>
          <span class="wv-hint-text">${esc(hint)}</span>
        </div>` : ""}
    </div>`;
}

// shortcut: feste Skala, 1,25 mm füllen den Balken; mehr Regen wird abgeschnitten (die Zahl darunter stimmt trotzdem).
function renderHours(hours, trainHour) {
  if (!hours?.length) return "";
  return `
    <div class="wv-hours">
      <div class="wv-hours-head"><span class="wv-heading">NÄCHSTE ${hours.length} STUNDEN</span><span class="wv-label">REGEN IN MM</span></div>
      <div class="wv-hour-grid">${hours.map((h, i) => `
        <div class="wv-hour${i ? "" : " now"}${h.hour === trainHour ? " train" : ""}">
          <span class="wv-hour-label">${i ? pad(h.hour) : "JETZT"}</span>
          <span class="wv-hour-temp">${h.temp}°</span>
          <div class="wv-rain"><div style="height: ${Math.min(100, (h.precip / 1.25) * 100)}%"></div></div>
          <span class="wv-note">${h.precip > 0 ? mm(h.precip) : "–"}</span>
        </div>`).join("")}
      </div>
    </div>`;
}

// Spanne lo–hi jedes Tages auf der gemeinsamen Skala der Woche.
function renderDays(days, d) {
  if (!days?.length) return "";
  const min = Math.min(...days.map(f => f.lo)), max = Math.max(...days.map(f => f.hi));
  const pct = v => ((v - min) / (max - min || 1)) * 100;
  return `
    <div class="wv-days">
      <span class="wv-heading">${days.length} TAGE</span>
      ${days.map((f, i) => `
        <div class="wv-day${i ? "" : " today"}">
          <span class="wv-dow">${i ? DOW_SHORT[(dowIndex(d) + i) % 7] : "HEUTE"}</span>
          ${f.icon ? icon(f.icon) : "<span></span>"}
          <span class="wv-day-label">${esc(f.label ?? "")}</span>
          <span class="wv-lo">${f.lo}°</span>
          <div class="wv-track"><div style="left: ${pct(f.lo)}%; width: ${pct(f.hi) - pct(f.lo)}%"></div></div>
          <span class="wv-hi">${f.hi}°</span>
        </div>`).join("")}
    </div>`;
}

export function renderWeather({ d, w, plan, today, sport = false }) {
  if (sport) return renderSportWeather({ d, w, plan, today });
  const session = nextSession(plan, today, d);
  const hint = trainingHint(w, session);
  const hours = renderHours(w.hours, hint ? Number(session.time.slice(0, 2)) : null);
  const days = renderDays(w.forecast, d);
  return `
    <header class="wv-top">
      <div class="wv-back">${icon("arrow-left")}<span>Wetter</span></div>
      <div class="wv-where">
        <span class="wv-heading">${esc((w.place ?? "").toUpperCase())} · ${DOW_LONG[dowIndex(d)]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.</span>
        <span class="dv-clock">${hhmm(d)}</span>
      </div>
    </header>
    <section class="wv">
      ${renderNow(w, session, hint)}
      <div class="wv-side">${hours}${hours && days ? `<div class="rule"></div>` : ""}${days}</div>
    </section>`;
}
