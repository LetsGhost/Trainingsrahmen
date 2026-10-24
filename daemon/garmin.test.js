// node --test daemon/
const test = require("node:test");
const assert = require("node:assert");
const { today, monday, tokenExpiry, toRecovery, missingHrvDays, toHrvHistory, toActivities, toThisWeek, withRecovery, withActivities } = require("./garmin");
const fixture = require("../fixtures/garmin.json");

test("today", () => {
  assert.equal(today(new Date(2026, 0, 5, 23, 30)), "2026-01-05");
});

test("tokenExpiry", () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1800000000 })).toString("base64url");
  assert.equal(tokenExpiry(`h.${payload}.s`), 1800000000 * 1000);
  assert.equal(tokenExpiry("kein-jwt"), 0);
});

test("toRecovery", () => {
  assert.deepEqual(toRecovery(fixture), {
    score: 84, sleepMinutes: 455, hrv: 67, restingHr: 46, batteryNow: 71,
    sleepDeep: 90, sleepLight: 260, sleepRem: 105, sleepAwake: 25, hrvWeekly: 64, hrvStatus: "BALANCED"
  });
  // Kein Schlaf und keine HRV für heute (leere Antworten): nur was da ist.
  assert.deepEqual(toRecovery({ sleep: null, hrv: null, summary: { restingHeartRate: 50, bodyBatteryAtWakeTime: null } }), { restingHr: 50 });
});

test("HRV-Verlauf: nur fehlende Vortage holen", () => {
  const now = new Date(2026, 9, 24, 12, 0);
  assert.deepEqual(missingHrvDays(null, now), ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
  const cached = [{ date: "2026-10-17", hrv: 50 }, { date: "2026-10-18", hrv: 60 }, { date: "2026-10-23", hrv: null }];
  assert.deepEqual(missingHrvDays(cached, now), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"],
    "Nacht ohne Wert wird nachgefragt");
  const history = toHrvHistory(cached, { "2026-10-20": 62, "2026-10-24": 67 }, now);
  assert.deepEqual(history.map(h => h.hrv), [60, null, 62, null, null, null, 67], "17. fällt raus, ältester zuerst");
  assert.equal(history[6].date, "2026-10-24");
});

test("withRecovery: Garmin geht vor, pro Feld", () => {
  const plan = { trainingsweek: [], recovery: { score: 70, sleepMinutes: 400, hrv: 55 } };
  assert.deepEqual(withRecovery(plan, { hrv: 67, restingHr: 46 }).recovery, { score: 70, sleepMinutes: 400, hrv: 67, restingHr: 46 });
  assert.deepEqual(withRecovery({ trainingsweek: [] }, { hrv: 67 }), { trainingsweek: [], recovery: { hrv: 67 } });
  assert.equal(withRecovery(plan, {}), plan);
  assert.equal(withRecovery(plan, null), plan);
  assert.equal(withRecovery(null, { hrv: 67 }), null);
  assert.equal(plan.recovery.hrv, 55, "Cache-Eintrag bleibt unverändert");
});

test("monday", () => {
  assert.equal(monday(new Date(2026, 9, 25, 23, 0)), "2026-10-19");
  assert.equal(monday(new Date(2026, 9, 19, 0, 30)), "2026-10-19");
  // Über die Zeitumstellung (25.10.) und den Monatswechsel.
  assert.equal(monday(new Date(2026, 10, 1, 12, 0)), "2026-10-26");
});

test("toActivities", () => {
  const list = toActivities(fixture.activities);
  assert.deepEqual(list[0], { date: "2026-10-19", time: "06:52", type: "running", title: "Berlin Laufen", duration: 58, distance: 10.2 });
  assert.deepEqual(list.map(a => a.type), ["running", "biking", "weightLifting", "other", "running"]);
  assert.equal("distance" in list[2], false, "0 m Krafttraining hat keine Distanz");
  assert.deepEqual(toActivities(null), []);
  assert.deepEqual(toActivities([{ activityName: "ohne Zeit" }]), []);
});

test("toThisWeek", () => {
  const moved = toThisWeek(toActivities(fixture.activities), new Date(2026, 10, 4, 12, 0));
  assert.deepEqual(moved.map(a => a.date), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-04"]);
});

test("withActivities", () => {
  const now = new Date(2026, 9, 24, 12, 0);
  const plan = { trainingsweek: [
    { day: "Montag", training: [{ type: "running", title: "Dauerlauf", duration: 55 }] },
    { day: "Mittwoch", training: [{ type: "weightLifting", title: "Plan A" }] },
    { day: "Donnerstag", training: [{ type: "biking", title: "Rolle" }] }
  ] };
  const activities = [
    { date: "2026-10-12", time: "07:00", type: "running", title: "Letzte Woche", duration: 30 },
    ...toActivities(fixture.activities)
  ];
  const out = withActivities(plan, activities, now).trainingsweek;
  assert.deepEqual(out[0].training[0], { type: "running", title: "Dauerlauf", duration: 55, done: { duration: 58, distance: 10.2 } });
  assert.deepEqual(out[1].training[0].done, { duration: 62 });
  assert.equal(out[2].training[0].done, undefined, "Lauf am Donnerstag ist keine Radeinheit");
  assert.deepEqual(out.slice(3).map(d => [d.day, d.training[0].title, d.training[0].unplanned]), [
    ["Dienstag", "Rennrad GA1", true], ["Mittwoch", "Yoga", true], ["Freitag", "Lockerer Lauf", true]
  ]);
  assert.equal(out[3].training[0].duration, undefined, "Ungeplantes zählt nicht in die Wochensumme");
  assert.equal(plan.trainingsweek[0].training[0].done, undefined, "Cache-Eintrag bleibt unverändert");
  assert.equal(withActivities(plan, [activities[0]], now), plan);
  assert.equal(withActivities(null, activities, now), null);
});
