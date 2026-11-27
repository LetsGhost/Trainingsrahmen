const test = require("node:test");
const assert = require("node:assert");
const { adapt } = require("./weather");

test("adapt: Windrichtung, Luftfeuchte und 12 Stunden ab der laufenden Stunde", () => {
  const time = Array.from({ length: 48 }, (_, i) => `2026-11-27T${String(i % 24).padStart(2, "0")}:00`).map((t, i) => (i >= 24 ? t.replace("27", "28") : t));
  const w = adapt({
    current: { time: "2026-11-27T14:15", temperature_2m: 9.4, apparent_temperature: 6, wind_speed_10m: 22, wind_direction_10m: 230, relative_humidity_2m: 88, weather_code: 61, is_day: 1 },
    hourly: { time, precipitation: time.map((_, i) => i / 10), temperature_2m: time.map(() => 8) },
    daily: { time: ["2026-11-27"], weather_code: [61], temperature_2m_max: [10], temperature_2m_min: [5], precipitation_sum: [3.2], sunrise: ["2026-11-27T08:01"], sunset: ["2026-11-27T16:05"] }
  }, "Hamburg");
  assert.equal(w.windDir, "Südwest");
  assert.equal(w.humidity, 88);
  assert.equal(w.sunrise, "08:01");
  assert.equal(w.hours.length, 12);
  assert.deepEqual(w.hours[0], { hour: 14, precip: 1.4, temp: 8 });
  assert.equal(w.hours[11].hour, 1);
});
