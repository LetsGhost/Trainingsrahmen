// Tagesansicht (Layout 1B): die Einheit groß links, rechts Wetter und die restliche Woche.
// Hat der Tag mehrere Einheiten, ist die erste groß, die übrigen stehen darunter als Liste.
import { DOW_LONG, DOW_SHORT, pad, hhmm, esc, icon, hyphenate } from "./util.js";

function titleSize(title) {
  if (title.length > 50) return " longer";
  if (title.length > 28) return " long";
  return "";
}

function renderRow(dow, s) {
  return `
    <div class="dv-row">
      <div class="dv-row-dow">${dow}</div>
      ${icon(s ? s.icon : "moon")}
      <div class="dv-row-title${s ? "" : " muted"}">${esc(s ? s.title : "Ruhetag")}</div>
      <div class="dv-row-meta">${esc(s ? [s.time, s.dur].filter(Boolean).join(" · ") || "—" : "—")}</div>
    </div>`;
}

function renderMain(main, more) {
  if (!main) {
    return `
      <div class="dv-sport">${icon("moon")}<div class="dv-sport-label">RUHETAG</div></div>
      <div class="dv-title">Kein Training</div>`;
  }
  const facts = [["START", main.time], ["DAUER", main.dur], ["BELASTUNG", main.intensity]].filter(([, v]) => v);
  return `
    <div class="dv-sport">${icon(main.icon)}<div class="dv-sport-label">${esc(main.sport)}</div></div>
    <div class="dv-title${titleSize(main.title)}">${esc(hyphenate(main.title))}</div>
    ${facts.length ? `<div class="dv-facts">${facts.map(([label, value]) => `
      <div class="dv-fact">
        <div class="dv-label">${label}</div>
        <div class="dv-fact-value">${esc(value)}</div>
      </div>`).join("")}</div>` : ""}
    ${main.description ? `<div class="dv-desc">${esc(main.description)}</div>` : ""}
    ${more.length ? `
      <div class="dv-more">
        <div class="dv-label">WEITERE EINHEITEN</div>
        ${more.map(s => renderRow("", s)).join("")}
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
export function renderDay({ d, date, index, today, plan, weather, recovery }) {
  const [main, ...more] = plan.days[index].sessions;
  const isToday = index === today;
  const upcoming = plan.days.slice(index + 1).map((day, k) => renderRow(DOW_SHORT[index + 1 + k], day.sessions[0]));
  return `
    <section class="dayview">
      <div class="dv-main">
        <div class="dv-top">
          <div class="kicker">${isToday ? "HEUTE · " : ""}${DOW_LONG[index]} ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.</div>
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
