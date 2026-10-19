// Wetter von Open-Meteo (ohne Key), übersetzt in das Modell, das das Display anzeigt:
// { place, label, icon, temp, feels, wind, precip, low, sunset, forecast: [{ icon, hi, lo }] } – forecast beginnt mit heute.
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
    precip: Number.isFinite(d.precipitation_sum?.[0]) ? Math.round(d.precipitation_sum[0] * 10) / 10 : 0,
    // Tiefstwert der kommenden Nacht ≈ Minimum des nächsten Tages.
    low: round(d.temperature_2m_min[1] ?? d.temperature_2m_min[0]),
    sunset: String(d.sunset?.[0] ?? "").slice(11, 16),
    forecast: d.time.map((_, i) => ({
      icon: describe(d.weather_code[i]).icon,
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
        current: "temperature_2m,apparent_temperature,wind_speed_10m,weather_code,is_day",
        daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunset",
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
