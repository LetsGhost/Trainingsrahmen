// Wetter von Open-Meteo (ohne Key), übersetzt in das Modell, das das Display anzeigt:
// { place, label, icon, temp, feels, wind, windDir, humidity, precip, low, sunrise, sunset, forecast: [{ icon, label, hi, lo }],
//   hours: [{ hour, precip, temp }] } – forecast beginnt mit heute, hours mit der laufenden Stunde (12 Stück, precip in mm).
// In der Entwicklung kommt das Wetter aus fixtures/weather.json, außer die Dev-Leiste schaltet „Echtes Wetter“ ein.
const fs = require("fs");
const { FrameError } = require("./errors");

const API = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 10000;

// WMO-Wettercodes → Text und Icon aus dem Sprite.
const CODES = [
  [[0], "Klar", "sun"],
  [[1, 2], "Heiter", "cloud-sun"],
  [[3], "Bedeckt", "cloud"],
  [[45, 48], "Nebel", "cloud-fog"],
  [[51, 53, 55, 56, 57], "Niesel", "cloud-drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Regen", "cloud-rain"],
  [[71, 73, 75, 77, 85, 86], "Schnee", "cloud-snow"],
  [[95, 96, 99], "Gewitter", "cloud-lightning"]
];

function describe(code, isDay = true) {
  const [, label, icon] = CODES.find(([codes]) => codes.includes(code)) ?? [null, "Wechselhaft", "cloud"];
  return { label, icon: icon === "sun" && !isDay ? "moon" : icon };
}

const round = n => (Number.isFinite(n) ? Math.round(n) : null);
const DIRS = ["Nord", "Nordost", "Ost", "Südost", "Süd", "Südwest", "West", "Nordwest"];
const compass = deg => (Number.isFinite(deg) ? DIRS[Math.round(deg / 45) % 8] : null);

// Ab der laufenden Stunde (current.time, Ortszeit) die nächsten 12 Stunden.
function nextHours(h, now) {
  if (!h?.time?.length) return [];
  const start = Math.max(0, h.time.findIndex(t => t.slice(0, 13) === String(now).slice(0, 13)));
  return h.time.slice(start, start + 12).map((t, i) => ({
    hour: Number(t.slice(11, 13)),
    precip: Math.round((h.precipitation[start + i] ?? 0) * 10) / 10,
    temp: round(h.temperature_2m[start + i])
  }));
}

function adapt(json, place) {
  const c = json.current, d = json.daily;
  if (!c || !d?.time?.length) throw new FrameError("BAD_DATA", "Open-Meteo liefert unvollständige Daten");
  const now = describe(c.weather_code, c.is_day === 1);
  return {
    place,
    label: now.label,
    icon: now.icon,
    temp: round(c.temperature_2m),
    feels: round(c.apparent_temperature),
    wind: round(c.wind_speed_10m),
    windDir: compass(c.wind_direction_10m),
    humidity: round(c.relative_humidity_2m),
    precip: Number.isFinite(d.precipitation_sum?.[0]) ? Math.round(d.precipitation_sum[0] * 10) / 10 : 0,
    // Tiefstwert der kommenden Nacht ≈ Minimum des nächsten Tages.
    low: round(d.temperature_2m_min[1] ?? d.temperature_2m_min[0]),
    sunrise: String(d.sunrise?.[0] ?? "").slice(11, 16),
    sunset: String(d.sunset?.[0] ?? "").slice(11, 16),
    hours: nextHours(json.hourly, c.time),
    forecast: d.time.map((_, i) => ({
      ...describe(d.weather_code[i]),
      hi: round(d.temperature_2m_max[i]),
      lo: round(d.temperature_2m_min[i])
    }))
  };
}

module.exports = function createWeather({ dev, sim, fixture }) {
  return {
    async fetch({ name, lat, lon }) {
      if (dev && !sim.liveWeather) {
        if (sim.noInternet) throw new FrameError("WEATHER_UNREACHABLE", "Open-Meteo nicht erreichbar");
        return { ...JSON.parse(fs.readFileSync(fixture, "utf8")), place: name };
      }
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        current: "temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,relative_humidity_2m,weather_code,is_day",
        hourly: "temperature_2m,precipitation",
        daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset",
        timezone: "auto",
        forecast_days: 7
      });
      let res;
      try {
        res = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new FrameError("WEATHER_UNREACHABLE", "Open-Meteo nicht erreichbar");
      }
      if (!res.ok) throw new FrameError("WEATHER_ERROR", `Open-Meteo antwortet mit ${res.status}`);
      return adapt(await res.json(), name);
    }
  };
};

module.exports.adapt = adapt;
