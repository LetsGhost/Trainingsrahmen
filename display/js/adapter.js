// Übersetzt das JSON des Sport-Analytics-Backends in das interne Wochenmodell.
// Ändert sich das Server-Format, ändert sich nur diese Datei.

const DAY_INDEX = {
  montag: 0, dienstag: 1, mittwoch: 2, donnerstag: 3, freitag: 4, samstag: 5, sonntag: 6
};

const SPORTS = {
  running: { label: "LAUFEN", icon: "footprints" },
  biking: { label: "RADFAHREN", icon: "bike" },
  swimming: { label: "SCHWIMMEN", icon: "waves" },
  weightLifting: { label: "KRAFT", icon: "dumbbell" }
};
const SPORT_FALLBACK = { label: "SONSTIGES", icon: "activity" };

const pad = n => String(n).padStart(2, "0");
const isMinutes = v => Number.isFinite(v) && v > 0;

// 45 → "45 min", 180 → "3 h 00"
export function formatDuration(min) {
  if (!isMinutes(min)) return null;
  return min < 120 ? `${min} min` : `${Math.floor(min / 60)} h ${pad(min % 60)}`;
}

// 545 → "9 h 05"
export function formatHours(min) {
  return isMinutes(min) ? `${Math.floor(min / 60)} h ${pad(min % 60)}` : null;
}

function adaptRecovery(r) {
  if (!r) return [];
  return [
    ["ERHOLUNG", Number.isFinite(r.score) ? String(r.score) : null],
    ["SCHLAF", formatHours(r.sleepMinutes)],
    ["HRV", Number.isFinite(r.hrv) ? `${r.hrv} ms` : null],
    ["RUHEPULS", Number.isFinite(r.restingHr) ? String(r.restingHr) : null]
  ].filter(([, value]) => value !== null).map(([label, value]) => ({ label, value }));
}

// Ergebnis: immer 7 Tage (Mo–So), jeder mit einer Liste von Einheiten.
// Pflicht sind nur type und title; time, duration, description, intensity und recovery sind optional.
export function adaptPlan(raw) {
  const days = Array.from({ length: 7 }, () => ({ sessions: [] }));
  let totalMinutes = 0;
  for (const entry of raw?.trainingsweek ?? []) {
    const i = DAY_INDEX[String(entry.day ?? "").trim().toLowerCase()];
    if (i === undefined) continue;
    for (const t of entry.training ?? []) {
      const sport = SPORTS[t.type] ?? SPORT_FALLBACK;
      if (isMinutes(t.duration)) totalMinutes += t.duration;
      days[i].sessions.push({
        sport: sport.label,
        icon: sport.icon,
        title: t.title ?? "",
        time: t.time ?? null,
        dur: formatDuration(t.duration),
        description: t.description ?? null,
        intensity: t.intensity ?? null
      });
    }
  }
  return { days, total: formatHours(totalMinutes), recovery: adaptRecovery(raw?.recovery) };
}
