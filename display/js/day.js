// Tagesansicht (Layout 1B): die Einheit groß links, rechts Wetter und die restliche Woche.
// Hat der Tag mehrere Einheiten, ist die erste groß, die übrigen stehen darunter als Liste.
import { DOW_LONG, DOW_SHORT, pad, hhmm, esc, icon, hyphenate } from "./util.js";

// Kopfzeile in Satzschreibung: „Heute · Mittwoch 09.09.“
const dayKicker = (index, today, date) =>
  `${index === today ? "Heute · " : ""}${DOW_LONG[index][0]}${DOW_LONG[index].slice(1).toLowerCase()} ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`;

function titleSize(title) {
  if (title.length > 50) return " longer";
  if (title.length > 28) return " long";
  return "";
}

// session: Index der Einheit am Tag; damit wird die Zeile unter „Weitere Einheiten“ antippbar und zeigt die Uhrzeit.
// In der restlichen Woche steht laut Vorlage nur die Dauer.
function renderRow(dow, s, session) {
  return `
    <div class="dv-row"${session === undefined ? "" : ` data-session="${session}"`}>
      <div class="dv-row-dow">${dow}</div>
      ${icon(s ? s.icon : "moon")}
      <div class="dv-row-title${s ? "" : " muted"}">${esc(s ? s.title : "Ruhetag")}</div>
      <div class="dv-row-meta">${esc(s ? [session !== undefined && s.time, s.unplanned ? s.done : s.dur].filter(Boolean).join(" · ") || "—" : "—")}</div>
      ${s?.done ? `<span class="dv-row-check">${icon("circle-check")}</span>` : ""}
    </div>`;
}

// „Kniebeuge 4 × 6, Hip Thrust 3 × 10, Plank 3 × 60 s.“ → [[Übung, Sätze, Wdh.], …]; null, wenn der Text
// keine Übungsliste ist (Fließtext oder Schwimm-Serien wie „6 × 100 m“ ohne Übungsnamen davor).
// strength: Kraft-Einheit, dort reicht eine Übung; sonst braucht es zwei, damit „Intervalle 5 × 3 min“ Text bleibt.
export function parseExercises(text, strength = false) {
  const parts = text.replace(/\.\s*$/, "").split(/,\s*/);
  const rows = parts.map(p => p.match(/^(.+?)\s+(\d+)\s*×\s*(.+)$/)?.slice(1) ?? (p.includes("×") ? null : [p, "", ""]));
  return (strength || parts.length > 1) && rows.every(Boolean) && rows.some(r => r[1]) ? rows : null;
}

function renderDescription(text, strength) {
  const rows = parseExercises(text, strength);
  if (!rows) return `<div class="dv-desc">${esc(text)}</div>`;
  return `
    <table class="dv-exercises">
      <thead><tr><th class="dv-label">ÜBUNG</th><th class="dv-label">SÄTZE</th><th class="dv-label">WDH.</th></tr></thead>
      <tbody>${rows.map(([name, sets, reps]) => `
        <tr><td>${esc(name)}</td><td>${esc(sets)}</td><td>${esc(reps)}</td></tr>`).join("")}
      </tbody>
    </table>`;
}

function renderMain(main, more) {
  if (!main) {
    return `
      <div class="dv-sport">${icon("moon")}<div class="dv-sport-label">RUHETAG</div></div>
      <div class="dv-title">Kein Training</div>`;
  }
  const facts = [["START", main.time], ["DAUER", main.dur], ["BELASTUNG", main.intensity], ["ERLEDIGT", main.done]]
    .filter(([, v]) => v);
  return `
    <div class="dv-sport" data-sport="${main.icon}">${icon(main.icon)}<div class="dv-sport-label">${esc(main.sport)}${main.unplanned ? " · UNGEPLANT" : ""}</div></div>
    <div class="dv-title${titleSize(main.title)}">${esc(hyphenate(main.title))}</div>
    ${facts.length ? `<div class="dv-facts">${facts.map(([label, value]) => `
      <div class="dv-fact">
        <div class="dv-label">${label}</div>
        <div class="dv-fact-value">${esc(value)}</div>
      </div>`).join("")}</div>` : ""}
    ${main.description ? renderDescription(main.description, main.icon === "dumbbell") : ""}
    ${more.length ? `
      <div class="dv-more">
        <div class="dv-label plain">Weitere Einheiten · antippen für Details</div>
        ${more.map(([i, s]) => renderRow("", s, i)).join("")}
      </div>` : ""}`;
}

function renderRecovery(recovery) {
  return `
    <div class="dv-recovery">${recovery.map(r => `
      <div>
        <div class="dv-label">${esc(r.label)}</div>
        <div class="dv-recovery-value">${esc(r.value)}</div>
      </div>`).join("")}
    </div>`;
}

// Vorhersage beginnt mit heute; die Wochentage ergeben sich daraus.
function renderWeather(weather, today) {
  return `
    <div class="dv-weather">
      <div class="dv-heading">WETTER ${esc(weather.place.toUpperCase())}</div>
      ${weather.forecast.slice(0, 7).map((f, k) => `
        <div class="dv-row">
          <div class="dv-row-dow">${DOW_SHORT[(today + k) % 7]}</div>
          ${icon(f.icon)}
          <div class="dv-row-line"></div>
          <div class="dv-hi">${f.hi}°</div>
          <div class="dv-lo">${f.lo}°</div>
        </div>`).join("")}
    </div>
    <div class="rule"></div>`;
}

// d: jetzt; date und index: der gewählte Tag; today: Index von heute.
// session: Index der groß gezeigten Einheit; die übrigen stehen als [Index, Einheit] darunter.
export function renderDay({ d, date, index, today, plan, weather, recovery, session = 0, sport = false }) {
  if (sport) return renderSportDay({ d, date, index, today, plan, weather, session });
  const sessions = plan.days[index].sessions;
  const main = sessions[session] ?? sessions[0];
  const more = [...sessions.entries()].filter(([, s]) => s !== main);
  const isToday = index === today;
  const upcoming = plan.days.slice(index + 1).map((day, k) => renderRow(DOW_SHORT[index + 1 + k], day.sessions[0]));
  return `
    <section class="dayview">
      <div class="dv-main">
        <div class="dv-top">
          <div class="kicker">${dayKicker(index, today, date)}</div>
          <div class="dv-clock">${hhmm(d)}</div>
        </div>
        <div class="dv-rule"></div>
        ${renderMain(main, more)}
        <div class="dv-spacer"></div>
        ${isToday && recovery.length ? renderRecovery(recovery) : ""}
      </div>
      <div class="dv-divider"></div>
      <div class="dv-side">
        ${weather?.forecast?.length ? renderWeather(weather, today) : ""}
        <div class="dv-week">
          <div class="dv-heading">RESTLICHE WOCHE</div>
          ${upcoming.length ? upcoming.join("") : `<div class="dv-row-title muted">Keine weiteren Tage diese Woche</div>`}
        </div>
      </div>
    </section>`;
}

// --- Theme Sport (Entwurf S3+): Einheit als Farbkarte, Übungen als Karte, weitere Einheiten als „Auch heute“;
// rechts Wetter mit Text je Tag und die restliche Woche mit Farbpunkt der Sportart. ---

// „Plan A – Unterkörper (Hüfte & Rumpf)“ → Titel und Untertitel.
export function splitTitle(title) {
  const m = title.match(/^(.+?)\s*\(([^()]+)\)$/);
  return m ? [m[1], m[2]] : [title, null];
}

function sportHero(main) {
  if (!main) return `<div class="sd-hero"><div class="sd-hero-top"><span class="sd-sport">RUHETAG</span></div><div class="sd-title">Kein Training</div></div>`;
  const [title, sub] = splitTitle(main.title);
  const facts = [["START", main.time], ["DAUER", main.dur], ["BELASTUNG", main.intensity]].filter(([, v]) => v);
  return `
    <div class="sd-hero" data-sport="${main.icon}">
      <div class="sd-hero-top">
        <span class="sd-sport">${esc(main.sport)}${main.unplanned ? " · UNGEPLANT" : ""}</span>
        ${main.done ? `<span class="sd-done">${icon("circle-check")}Erledigt · ${esc(main.done)}</span>` : ""}
      </div>
      <div class="sd-title${titleSize(title)}">${esc(hyphenate(title))}</div>
      ${sub ? `<div class="sd-sub">${esc(sub)}</div>` : ""}
      ${facts.length ? `<div class="sd-facts">${facts.map(([k, v]) => `<div><div class="sd-label">${k}</div><div class="sd-fact">${esc(v)}</div></div>`).join("")}</div>` : ""}
    </div>`;
}

function sportDescription(main) {
  if (!main?.description) return "";
  const rows = parseExercises(main.description, main.icon === "dumbbell");
  if (!rows) return `<div class="sd-card sd-text">${esc(main.description)}</div>`;
  return `
    <div class="sd-card">
      <div class="sd-card-head"><span class="sd-label">ÜBUNGEN</span><span class="sd-label">SÄTZE × WDH.</span></div>
      ${rows.map(([name, sets, reps]) => `
        <div class="sd-ex"><span>${esc(name)}</span><span>${esc(sets ? `${sets} × ${reps}` : reps)}</span></div>`).join("")}
    </div>`;
}

function sportMore(more) {
  return more.map(([i, s]) => `
    <div class="sd-more" data-session="${i}">
      <span class="sd-label">AUCH HEUTE</span>
      <span class="sd-more-title">${esc(s.title)}</span>
      <span class="sd-more-meta">${esc([s.time, s.unplanned ? s.done : s.dur].filter(Boolean).join(" · "))}</span>
      ${s.done ? `<span class="sd-more-done">${icon("circle-check")}Erledigt</span>` : ""}
    </div>`).join("");
}

function sportWeather(w, today) {
  return `
    <div class="sd-card sd-weather">
      <div class="sd-label">WETTER ${esc(w.place.toUpperCase())}</div>
      <div class="sd-now"><span class="sd-temp">${w.temp}°</span><span class="sd-now-label">${esc(w.label)}</span><span class="sd-muted">nachts ${w.low}°</span></div>
      ${w.forecast.slice(1, 7).map((f, k) => `
        <div class="sd-row">
          <span class="sd-dow">${DOW_SHORT[(today + 1 + k) % 7]}</span>
          <span class="sd-row-title">${esc(f.label ?? "")}</span>
          <span class="sd-hi">${f.hi}°</span><span class="sd-lo">${f.lo}°</span>
        </div>`).join("")}
    </div>`;
}

function sportWeek(plan, index) {
  const rows = plan.days.slice(index + 1).map((day, k) => {
    const s = day.sessions[0];
    return `
      <div class="sd-row">
        <span class="sd-dow">${DOW_SHORT[index + 1 + k]}</span>
        <span class="sd-dot"${s ? ` data-sport="${s.icon}"` : ""}></span>
        <span class="sd-row-title${s ? "" : " sd-muted"}">${esc(s ? splitTitle(s.title)[0] : "Ruhetag")}</span>
        <span class="sd-muted">${esc(s?.dur ?? "")}</span>
      </div>`;
  });
  return `
    <div class="sd-card sd-week">
      <div class="sd-label">RESTLICHE WOCHE</div>
      ${rows.length ? rows.join("") : `<div class="sd-row sd-muted">Keine weiteren Tage diese Woche</div>`}
    </div>`;
}

function renderSportDay({ d, date, index, today, plan, weather, session }) {
  const sessions = plan.days[index].sessions;
  const main = sessions[session] ?? sessions[0];
  const more = [...sessions.entries()].filter(([, s]) => s !== main);
  return `
    <section class="sportday">
      <div class="sd-main">
        <div class="sd-top">
          <div class="kicker">${dayKicker(index, today, date)}</div>
          <div class="dv-clock">${hhmm(d)}</div>
        </div>
        ${sportHero(main)}
        ${sportDescription(main)}
        <div class="dv-spacer"></div>
        ${sportMore(more)}
      </div>
      <div class="sd-side">
        ${weather?.forecast?.length ? sportWeather(weather, today) : ""}
        ${sportWeek(plan, index)}
      </div>
    </section>`;
}
