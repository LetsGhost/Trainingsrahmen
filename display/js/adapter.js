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

// Ergebnis: immer 7 Tage (Mo–So), jeder mit einer Liste von Einheiten.
// time und dur liefert der Server derzeit nicht; sie werden durchgereicht, falls sie dazukommen.
export function adaptPlan(raw) {
  const days = Array.from({ length: 7 }, () => ({ sessions: [] }));
  for (const entry of raw?.trainingsweek ?? []) {
    const i = DAY_INDEX[String(entry.day ?? "").trim().toLowerCase()];
    if (i === undefined) continue;
    for (const t of entry.training ?? []) {
      const sport = SPORTS[t.type] ?? SPORT_FALLBACK;
      days[i].sessions.push({
        sport: sport.label,
        icon: sport.icon,
        title: t.title ?? "",
        time: t.time ?? null,
        dur: t.duration ?? null
      });
    }
  }
  return { days, recovery: raw?.recovery ?? null };
}
