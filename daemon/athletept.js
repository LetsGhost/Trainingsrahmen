// Datenquelle AthletePT 3.0: holt Woche und aktiven Plan des Athleten und baut daraus das Format
// des Sport-Analytics-Backends ({ trainingsweek }), damit display/js/adapter.js unverändert bleibt.
// Benötigte Key-Bereiche: workouts:read und plans:read.

const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

// Freitexte aus dem Wochenplan („Laufen“, „Rad“ …) auf die Sportarten des Rahmens abbilden.
const SPORT_WORDS = [
  [/\b(lauf|jogg|run)/i, "running"],
  [/rad|bike|cycl|spinning/i, "biking"],
  [/schwimm|swim/i, "swimming"],
  [/kraft|gym|hantel/i, "weightLifting"]
];
const guessSport = text => SPORT_WORDS.find(([re]) => re.test(text))?.[1] ?? "other";

// https://app.example.de, …/api oder …/api/v1 → https://app.example.de/api/v1
const apiBase = url => url.replace(/\/+$/, "").replace(/\/api(\/v1)?$/, "") + "/api/v1";

// Erster Arbeitssatz steht für alle: „Kniebeuge 4 × 6–8“.
// shortcut: unterschiedliche Sätze einer Übung zeigen nur den ersten, bei Bedarf wie set-summary.ts in AthletePT gruppieren.
function exerciseLine(ex) {
  const working = ex.sets.filter(s => s.kind === "working");
  const s = working[0];
  if (!s) return ex.exerciseName;
  const amount = s.durationSeconds != null ? `${s.durationSeconds} s`
    : s.repsMax != null && s.repsMax !== s.repsMin ? `${s.repsMin}–${s.repsMax}`
    : s.repsMin != null ? String(s.repsMin) : null;
  return amount ? `${ex.exerciseName} ${working.length} × ${amount}` : ex.exerciseName;
}

// week: Antwort von GET /me/week, plan: Antwort von GET /me/plan ({ plan: … | null }).
function toTrainingsweek(week, plan) {
  const planDays = new Map((plan?.plan?.days ?? []).map(d => [d.id, d]));
  const trainingsweek = DAY_NAMES.map(day => ({ day, training: [] }));
  // Plantage ohne Wochentag lassen sich im Raster nicht einordnen.
  for (const d of week.days ?? []) {
    if (!(d.weekday >= 1 && d.weekday <= 7)) continue;
    const exercises = planDays.get(d.dayId)?.exercises ?? [];
    trainingsweek[d.weekday - 1].training.push({
      type: "weightLifting",
      title: d.name,
      description: exercises.length ? exercises.map(exerciseLine).join(", ") : undefined
    });
  }
  (week.activities ?? []).forEach((text, i) => {
    if (text && i < 7) trainingsweek[i].training.push({ type: guessSport(text), title: text });
  });
  return { trainingsweek };
}

// „Plan A – Unterkörper (Hüfte)“ → „plan a unterkörper hüfte“
const normalize = s => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const dayKey = day => String(day ?? "").trim().toLowerCase();

// Gleich heißt: gleicher Tag und ein Titel ist der Anfang des anderen („Plan A Unterkörper“ ↔ „Plan A Unterkörper (Hüfte)“).
// Laufen, Rad und Schwimmen kommen bei AthletePT nur als Freitext („Laufen“); die gelten als gleich,
// wenn Sport-Analytics am selben Tag schon eine Einheit dieser Sportart hat.
function isSame(a, b) {
  const ta = normalize(a.title), tb = normalize(b.title);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length >= 4 && (long === short || long.startsWith(short + " "))) return true;
  return b.type === a.type && ["running", "biking", "swimming"].includes(b.type);
}

const isEmpty = v => v === undefined || v === null || v === "";

// Sport-Analytics-Plan (mit recovery) mit AthletePT zusammenführen:
// - Gibt es eine Einheit in beiden, bleibt die von Sport-Analytics; fehlende Felder (z. B. die Übungen
//   in description) kommen von AthletePT.
// - Einheiten nur in AthletePT werden angehängt. Der Adapter sammelt pro Wochentag, doppelte Tage in
//   trainingsweek sind also kein Problem.
// Die Eingaben stammen aus dem Cache und werden nicht verändert.
function mergePlans(base, extra) {
  if (!extra) return base;
  if (!base) return extra;
  const extraOn = day => extra.trainingsweek.filter(d => dayKey(d.day) === dayKey(day)).flatMap(d => d.training ?? []);
  const used = new Set();
  const trainingsweek = base.trainingsweek.map(d => ({
    ...d,
    training: (d.training ?? []).map(b => {
      const match = extraOn(d.day).find(t => !used.has(t) && isSame(b, t));
      if (!match) return b;
      used.add(match);
      const filled = { ...b };
      for (const [key, value] of Object.entries(match)) if (isEmpty(filled[key])) filled[key] = value;
      return filled;
    })
  }));
  const added = extra.trainingsweek.map(d => ({ ...d, training: (d.training ?? []).filter(t => !used.has(t)) }));
  return { ...base, trainingsweek: [...trainingsweek, ...added] };
}

module.exports = { apiBase, toTrainingsweek, mergePlans };
