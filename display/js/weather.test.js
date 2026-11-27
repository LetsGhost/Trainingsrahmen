import test from "node:test";
import assert from "node:assert/strict";
import { nextSession, trainingHint } from "./weather.js";

const w = { hours: [14, 15, 16, 17, 18].map((hour, i) => ({ hour, precip: [0.8, 1.2, 0.6, 0, 0][i], temp: 7 })) };

test("trainingHint: trocken ab der ersten Stunde nach dem Regen", () => {
  assert.equal(trainingHint(w, { time: "18:00" }), "Ab 17 Uhr trocken, 7° – draußen gut machbar.");
  assert.equal(trainingHint(w, { time: "15:30" }), "Um 15 Uhr Regen (1,2 mm), 7° – Regenjacke oder drinnen.");
  assert.equal(trainingHint({ hours: [{ hour: 9, precip: 0, temp: 3 }] }, { time: "09:00" }), "Trocken, 3° – draußen gut machbar.");
  assert.equal(trainingHint(w, { time: "22:00" }), null);
  assert.equal(trainingHint(w, null), null);
});

test("nextSession: erste offene Einheit heute ab der laufenden Stunde", () => {
  const plan = { days: [{ sessions: [{ time: "07:00" }, { time: "18:00", done: "x" }, { time: "19:00" }, { time: null }] }] };
  assert.equal(nextSession(plan, 0, new Date(2026, 10, 27, 14)).time, "19:00");
  assert.equal(nextSession(plan, 0, new Date(2026, 10, 27, 20)), null);
});
