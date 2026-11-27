// Wetter-Vollbild im Theme Sport (Entwurf #ws): links jetzt als Farbkarte, Kennzahlen und Trainingshinweis,
// rechts Regen der nächsten 12 Stunden und 7 Tage auf gemeinsamer Temperaturskala.
import { DOW_SHORT, DOW_LONG, MONTHS, pad, hhmm, esc, icon } from "./util.js";
import { nextSession, trainingHint } from "./weather.js";

const has = v => v != null && v !== "";

function fact(label, value, sub) {
  return has(value) ? `<div class="sw-fact"><span class="sw-label">${label}</span><span class="sw-val">${esc(value)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></div>` : "";
}

function nowCard(w) {
  const hi = w.forecast?.[0]?.hi;
  const lo = w.low ?? w.forecast?.[0]?.lo;
  const sub = [has(w.feels) && `gefühlt ${w.feels}°`, has(hi) && has(lo) && `${hi}° / ${lo}°`].filter(Boolean).join(" · ");
  return `
    <div class="sw-now">
      <div class="sw-now-top"><span class="sw-label">${esc(String(w.place ?? "").toUpperCase())} · JETZT</span>${w.icon ? icon(w.icon) : ""}</div>
      <div class="sw-temp">${has(w.temp) ? `${w.temp}°` : "–"}</div>
      <div class="sw-now-sub"><span>${esc(w.label ?? "")}</span><span>${esc(sub)}</span></div>
    </div>`;
}

function facts(w) {
  const cells = [
    fact("WIND", has(w.wind) ? `${w.wind} km/h` : null, w.windDir && `aus ${w.windDir}`),
    fact("REGEN HEUTE", has(w.precip) ? `${String(w.precip).replace(".", ",")} mm` : null),
    fact("LUFTFEUCHTE", has(w.humidity) ? `${w.humidity} %` : null),
    fact("SONNE", w.sunrise, w.sunset && `bis ${w.sunset}`)
  ].join("");
  return cells ? `<div class="sw-facts">${cells}</div>` : "";
}

function hint(w, session) {
  const text = trainingHint(w, session);
  return text ? `
    <div class="sw-hint">
      <span class="sw-label">${esc(String(session.sport ?? "").toUpperCase())} · ${esc(session.time)}</span>
      <span class="sw-hint-text">${esc(text)}</span>
    </div>` : "";
}

function hours(w, session) {
  const hs = w.hours ?? [];
  if (!hs.length) return "";
  const max = Math.max(...hs.map(h => h.precip ?? 0));
  const at = session ? Number(session.time.slice(0, 2)) : null;
  return `
    <div class="sw-card">
      <div class="sw-card-head"><span class="sw-label">NÄCHSTE 12 STUNDEN</span><span class="sw-label sw-legend">■ REGEN</span></div>
      <div class="sw-hours">
        ${hs.map((h, i) => `
          <div class="sw-hour${i === 0 ? " now" : ""}">
            <span class="sw-hour-label">${i === 0 ? "Jetzt" : pad(h.hour)}</span>
            <span class="sw-hour-temp">${has(h.temp) ? `${h.temp}°` : ""}</span>
            <div class="sw-bar-box"><div class="sw-bar${h.precip > 0 ? " wet" : ""}${h.hour === at ? " train" : ""}"
              style="height:${h.precip > 0 ? Math.max(4, Math.round(h.precip / max * 30)) : 4}px"></div></div>
          </div>`).join("")}
      </div>
    </div>`;
}

function week(w, today) {
  const days = (w.forecast ?? []).filter(f => has(f.hi) && has(f.lo));
  if (!days.length) return "";
  const min = Math.min(...days.map(f => f.lo));
  const span = Math.max(1, Math.max(...days.map(f => f.hi)) - min);
  return `
    <div class="sw-card sw-week">
      <div class="sw-label">7 TAGE</div>
      ${days.map((f, i) => `
        <div class="sw-day">
          <span class="sw-dow${i === 0 ? " today" : ""}">${i === 0 ? "HEUTE" : DOW_SHORT[(today + i) % 7]}</span>
          ${f.icon ? icon(f.icon) : "<span></span>"}
          <span class="sw-lo">${f.lo}°</span>
          <div class="sw-range"><div style="left:${Math.round((f.lo - min) / span * 100)}%;width:${Math.round((f.hi - f.lo) / span * 100)}%"></div></div>
          <span class="sw-hi">${f.hi}°</span>
        </div>`).join("")}
    </div>`;
}

export function renderSportWeather({ d, w, plan, today }) {
  const session = nextSession(plan, today, d);
  return `
    <header class="sw-top">
      <div class="sw-back"><span>←</span><span>Woche</span></div>
      <div class="sw-title">WETTER</div>
      <div class="sw-date">${DOW_LONG[today]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}</div>
      <div class="sw-clock">${hhmm(d)}</div>
    </header>
    <section class="sw"${session ? ` data-sport="${esc(session.icon)}"` : ""}>
      <div class="sw-col">
        ${nowCard(w)}
        ${facts(w)}
        <div class="sw-spacer"></div>
        ${hint(w, session)}
      </div>
      <div class="sw-col">
        ${hours(w, session)}
        ${week(w, today)}
      </div>
    </section>`;
}
