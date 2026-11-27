import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSportWeather } from "./weather-sport.js";

const w = JSON.parse(readFileSync(new URL("../../fixtures/weather.json", import.meta.url)));
const d = new Date(2026, 10, 27, 14, 10);
const plan = { days: Array.from({ length: 7 }, () => ({ sessions: [] })) };
plan.days[4].sessions = [{ sport: "Laufen", icon: "footprints", title: "Lauf", time: "18:00", done: null }];

test("Sport-Wetter: Hinweis in Farbe der nächsten Einheit, Trainingsstunde markiert", () => {
  const html = renderSportWeather({ d, w, plan, today: 4 });
  assert.match(html, /data-sport="footprints"/);
  assert.match(html, /LAUFEN · 18:00/);
  assert.equal(html.match(/sw-bar[^"]* train/g).length, 1);
  assert.equal(html.match(/class="sw-day"/g).length, 7);
});

test("Sport-Wetter: fehlende Daten lassen Abschnitte weg statt zu crashen", () => {
  const html = renderSportWeather({ d, w: { place: "Berlin", temp: 5, hours: [], forecast: [] }, plan: null, today: 4 });
  assert.doesNotMatch(html, /sw-hint|sw-hours|sw-week|sw-facts/);
  assert.match(html, /5°/);
});
