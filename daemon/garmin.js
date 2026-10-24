// Datenquelle Garmin Connect Personal API (nur lesen): Schlaf, HRV, Ruhepuls und Body Battery von heute,
// der HRV-Verlauf der letzten 7 Tage, dazu die Aktivitäten der laufenden Woche, die im Plan als erledigt erscheinen.
// Der API-Key aus Garmin Connect → Einstellungen → Personal API wird gegen ein Bearer-Token (JWT, 24 h) getauscht.
// Spezifikation: https://developer.garmin.com/gc-developer-program/personal/swagger-docs/
const { DAY_NAMES, dayKey } = require("./athletept");

const BASE = "https://personal.connectapi.garmin.com";
const TOKEN_URL = `${BASE}/personalapitoken-service/personal-api/personal-api-key/token`;

// Datum als „YYYY-MM-DD“ in der Zeitzone des Pi; Schlaf und HRV hängen am Tag des Aufwachens.
const today = (now = new Date()) => now.toLocaleDateString("sv-SE");
const dow = date => (new Date(`${date}T12:00`).getDay() + 6) % 7;
const addDays = (date, n) => today(new Date(new Date(`${date}T12:00`).getTime() + n * 86400000));
const monday = (now = new Date()) => addDays(today(now), -dow(today(now)));

const urls = (now = new Date()) => {
  const date = today(now);
  return {
    sleep: `${BASE}/sleep-service/sleep/dailySleep?date=${date}`,
    hrv: hrvUrl(date),
    summary: `${BASE}/usersummary-service/usersummary/daily?calendarDate=${date}`,
    activities: `${BASE}/activitylist-service/activities/search/activities?startDate=${monday(now)}&endDate=${date}&limit=100`
  };
};

// exp-Claim des JWT in ms, ohne die Signatur zu prüfen.
function tokenExpiry(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp * 1000;
  } catch {
    return 0;
  }
}

const num = v => (Number.isFinite(v) ? v : undefined);
const positive = v => (Number.isFinite(v) && v > 0 ? v : undefined);
const defined = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const minutes = seconds => num(seconds) && Math.round(seconds / 60);

// Antworten (jeweils null, wenn Garmin für heute nichts hat) → recovery im Format des Sport-Analytics-Backends.
// Erholung ist die Body Battery beim Aufwachen. Die Felder ab batteryNow braucht nur die Erholungs-Ansicht.
function toRecovery({ sleep, hrv, summary }) {
  return defined({
    score: num(summary?.bodyBatteryAtWakeTime),
    sleepMinutes: minutes(sleep?.sleepTimeSeconds),
    hrv: num(hrv?.hrvSummary?.lastNightAvg),
    restingHr: num(summary?.restingHeartRate),
    batteryNow: num(summary?.bodyBatteryMostRecentValue),
    sleepDeep: minutes(sleep?.deepSleepSeconds),
    sleepLight: minutes(sleep?.lightSleepSeconds),
    sleepRem: minutes(sleep?.remSleepSeconds),
    sleepAwake: minutes(sleep?.awakeSleepSeconds),
    hrvWeekly: num(hrv?.hrvSummary?.weeklyAvg),
    hrvStatus: hrv?.hrvSummary?.status || undefined
  });
}

// Die letzten 7 Tage bis heute, ältester zuerst.
const lastWeek = (now = new Date()) => Array.from({ length: 7 }, (_, i) => addDays(today(now), i - 6));

// Vortage ohne HRV im Cache. Heute wird immer neu geholt. Eine Nacht ohne Wert (null) wird nachgefragt,
// weil die Uhr oft erst später synchronisiert; Nächte mit Wert ändern sich nicht mehr.
const missingHrvDays = (history, now = new Date()) =>
  lastWeek(now).slice(0, 6).filter(date => !(history ?? []).some(h => h.date === date && h.hrv !== null));

const hrvOf = response => num(response?.hrvSummary?.lastNightAvg) ?? null;
const hrvUrl = date => `${BASE}/hrv-service/hrv/${date}`;

// HRV-Verlauf [{ date, hrv }] der letzten 7 Tage; hrv ist null, wenn Garmin für die Nacht nichts hat.
// fetched: { date: hrv } aus diesem Abruf geht vor dem Cache.
function toHrvHistory(cached, fetched, now = new Date()) {
  const known = Object.fromEntries([...(cached ?? []).map(h => [h.date, h.hrv]), ...Object.entries(fetched)]);
  return lastWeek(now).map(date => ({ date, hrv: known[date] ?? null }));
}

// Garmin-typeKey (running, trail_running, indoor_cycling, lap_swimming, strength_training …) → Sportart des Rahmens.
const SPORT_KEYS = [[/run/, "running"], [/cycl|bik|ride/, "biking"], [/swim/, "swimming"], [/strength/, "weightLifting"]];

// Aktivitätsliste → { date, time, type, title, duration (min), distance (km) }, nach Startzeit sortiert.
function toActivities(list) {
  return (Array.isArray(list) ? list : [])
    .filter(a => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(a?.startTimeLocal ?? ""))
    .sort((a, b) => a.startTimeLocal.localeCompare(b.startTimeLocal))
    .map(a => defined({
      date: a.startTimeLocal.slice(0, 10),
      time: a.startTimeLocal.slice(11, 16),
      type: SPORT_KEYS.find(([re]) => re.test(a.activityType?.typeKey ?? ""))?.[1] ?? "other",
      title: a.activityName || "Aktivität",
      duration: positive(a.duration) && Math.round(a.duration / 60),
      distance: positive(a.distance) && Math.round(a.distance / 100) / 10
    }));
}

const toGarmin = (responses, hrvHistory) => ({
  recovery: { ...toRecovery(responses), ...(hrvHistory && { hrvHistory }) },
  activities: toActivities(responses.activities)
});

// Für die Fixture: Aktivitäten auf denselben Wochentag der laufenden Woche legen, nichts nach heute.
function toThisWeek(activities, now = new Date()) {
  const start = monday(now);
  return activities.map(a => ({ ...a, date: addDays(start, dow(a.date)) })).filter(a => a.date <= today(now));
}

// Werte von Garmin gehen vor, pro Feld; was Garmin nicht hat, bleibt vom Plan. Ohne Plan keine Anzeige.
function withRecovery(plan, recovery) {
  if (!plan || !recovery || !Object.keys(recovery).length) return plan;
  return { ...plan, recovery: { ...plan.recovery, ...recovery } };
}

const doneOf = a => defined({ duration: a.duration, distance: a.distance });

// Aktivitäten der laufenden Woche an den Plan hängen:
// - Gleicher Wochentag und gleiche Sportart → die geplante Einheit bekommt done (in Reihenfolge der Startzeit).
//   „Sonstiges“ wird nie zugeordnet, weil die Sportart dort nichts aussagt.
// - Der Rest kommt als ungeplante Einheit (unplanned) dazu, ohne duration, damit die Wochensumme der Plan bleibt.
// Aktivitäten außerhalb der Woche (alter Cache nach dem Wochenwechsel) zählen nicht.
function withActivities(plan, activities, now = new Date()) {
  const from = monday(now), to = today(now);
  const week = (activities ?? []).filter(a => a.date >= from && a.date <= to);
  if (!plan || !week.length) return plan;
  const used = new Set();
  const dayOf = a => DAY_NAMES[dow(a.date)];
  const trainingsweek = plan.trainingsweek.map(d => ({
    ...d,
    training: (d.training ?? []).map(t => {
      const match = week.find(a => !used.has(a) && a.type !== "other" && a.type === t.type && dayKey(dayOf(a)) === dayKey(d.day));
      if (!match) return t;
      used.add(match);
      return { ...t, done: doneOf(match) };
    })
  }));
  const unplanned = week.filter(a => !used.has(a)).map(a => ({
    day: dayOf(a),
    training: [{ type: a.type, title: a.title, time: a.time, unplanned: true, done: doneOf(a) }]
  }));
  return { ...plan, trainingsweek: [...trainingsweek, ...unplanned] };
}

module.exports = { TOKEN_URL, today, monday, urls, hrvUrl, hrvOf, missingHrvDays, toHrvHistory, tokenExpiry, toRecovery, toActivities, toGarmin, toThisWeek, withRecovery, withActivities };
