// node --test daemon/
const test = require("node:test");
const assert = require("node:assert");
const { apiBase, toTrainingsweek, mergePlans } = require("./athletept");

test("apiBase", () => {
  assert.equal(apiBase("https://a.de/"), "https://a.de/api/v1");
  assert.equal(apiBase("https://a.de/api/v1/"), "https://a.de/api/v1");
});

test("mergePlans", () => {
  const base = { trainingsweek: [{ day: "Montag", training: [{ type: "running", title: "A" }] }], recovery: { score: 70 } };
  const extra = { trainingsweek: [{ day: "Montag", training: [{ type: "weightLifting", title: "B" }] }] };
  assert.deepEqual(mergePlans(base, extra), { trainingsweek: [...base.trainingsweek, ...extra.trainingsweek], recovery: { score: 70 } });
  assert.equal(mergePlans(base, null), base);
  assert.equal(mergePlans(null, extra), extra);
  assert.equal(mergePlans(null, null), null);
});

test("mergePlans lässt Doppelte weg", () => {
  const base = { trainingsweek: [
    { day: "Montag", training: [{ type: "running", title: "Dauerlauf 1" }] },
    { day: "Mittwoch", training: [{ type: "weightLifting", title: "Plan A - Unterkörper (Hüfte & Rumpf)" }] }
  ] };
  const extra = { trainingsweek: [
    { day: "Montag", training: [{ type: "running", title: "Laufen" }, { type: "other", title: "Fußball" }] },
    { day: "Dienstag", training: [{ type: "running", title: "Laufen" }] },
    { day: "Mittwoch", training: [{ type: "weightLifting", title: "Plan A – Unterkörper" }, { type: "weightLifting", title: "Plan B – Oberkörper" }] }
  ] };
  const titles = mergePlans(base, extra).trainingsweek.slice(2).map(d => d.training.map(t => t.title));
  assert.deepEqual(titles, [["Fußball"], ["Laufen"], ["Plan B – Oberkörper"]]);
});

test("mergePlans ergänzt fehlende Felder aus AthletePT", () => {
  const sports = { type: "weightLifting", title: "Plan A - Unterkörper", time: "18:30", description: "" };
  const base = { trainingsweek: [{ day: "Mittwoch", training: [sports] }] };
  const extra = { trainingsweek: [{ day: "mittwoch", training: [
    { type: "weightLifting", title: "Plan A – Unterkörper", description: "Kniebeuge 4 × 6" }
  ] }] };
  const merged = mergePlans(base, extra).trainingsweek;
  assert.deepEqual(merged[0].training, [{ ...sports, description: "Kniebeuge 4 × 6" }]);
  assert.deepEqual(merged[1].training, []);
  assert.equal(sports.description, "", "Cache-Eintrag bleibt unverändert");
  // Vorhandene Werte von Sport-Analytics gewinnen.
  const withText = { trainingsweek: [{ day: "Mittwoch", training: [{ ...sports, description: "Eigener Text" }] }] };
  assert.equal(mergePlans(withText, extra).trainingsweek[0].training[0].description, "Eigener Text");
});

test("toTrainingsweek", () => {
  const week = {
    days: [
      { dayId: "d1", name: "Unterkörper", weekday: 3 },
      { dayId: "d2", name: "Ohne Tag", weekday: null }
    ],
    activities: ["Laufen", null, null, null, null, null, "Fußball"]
  };
  const plan = {
    plan: {
      days: [{
        id: "d1",
        exercises: [
          { exerciseName: "Kniebeuge", sets: [
            { kind: "warmup", repsMin: 10, repsMax: null, durationSeconds: null },
            { kind: "working", repsMin: 6, repsMax: 8, durationSeconds: null },
            { kind: "working", repsMin: 6, repsMax: 8, durationSeconds: null }
          ] },
          { exerciseName: "Plank", sets: [{ kind: "working", repsMin: null, repsMax: null, durationSeconds: 60 }] }
        ]
      }]
    }
  };
  const { trainingsweek } = toTrainingsweek(week, plan);
  assert.equal(trainingsweek.length, 7);
  assert.deepEqual(trainingsweek[0].training, [{ type: "running", title: "Laufen" }]);
  assert.deepEqual(trainingsweek[2].training, [
    { type: "weightLifting", title: "Unterkörper", description: "Kniebeuge 2 × 6–8, Plank 1 × 60 s" }
  ]);
  assert.deepEqual(trainingsweek[6].training, [{ type: "other", title: "Fußball" }]);
  assert.equal(trainingsweek.flatMap(d => d.training).length, 3);
  assert.deepEqual(toTrainingsweek({ days: [], activities: [] }, { plan: null }).trainingsweek[0].training, []);
});
