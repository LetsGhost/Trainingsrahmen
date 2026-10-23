// Zugriff auf das Sport-Analytics-Backend: GET {url}/data mit Header x-api-key.
// Das Format der Antwort kennt nur display/js/adapter.js; hier wird nur geprüft, dass es nach einem Plan aussieht.
// In der Entwicklung kommt der Plan aus den Fixtures, außer die Dev-Leiste schaltet „Echter Server“ ein.
const fs = require("fs");
const { FrameError } = require("./errors");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const TIMEOUT_MS = 10000;
const KEY_REJECTED = () => new FrameError("KEY_REJECTED", "Server lehnt den API-Key ab");

async function request({ url, apiKey }) {
  let res;
  try {
    // Wer die volle Adresse mit „/data“ einträgt, soll nicht bei …/data/data landen.
    res = await fetch(url.replace(/\/+$/, "").replace(/\/data$/, "") + "/data", {
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new FrameError("SERVER_UNREACHABLE", "Server nicht erreichbar");
  }
  if (res.status === 401 || res.status === 403) throw KEY_REJECTED();
  if (!res.ok) throw new FrameError("SERVER_ERROR", `Server antwortet mit ${res.status}`);
  return res;
}

function parsePlan(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FrameError("BAD_DATA", "Server liefert kein gültiges JSON");
  }
  if (!Array.isArray(data?.trainingsweek)) throw new FrameError("BAD_DATA", "Antwort enthält keinen Wochenplan");
  return data;
}

// fixture(): Pfad der Fixture, die die Dev-Leiste gewählt hat.
module.exports = function createBackend({ dev, sim, fixture }) {
  const live = () => !dev || sim.liveServer;

  async function simulate() {
    await delay(300);
    if (sim.noInternet) throw new FrameError("SERVER_UNREACHABLE", "Server nicht erreichbar");
    if (sim.keyRejected) throw KEY_REJECTED();
  }

  return {
    // Bei der Einrichtung: Erreichbarkeit und Key prüfen.
    async check(server) {
      if (!live()) return simulate();
      await request(server);
    },

    async fetchPlan(server) {
      if (!live()) {
        await simulate();
        return parsePlan(fs.readFileSync(fixture(), "utf8"));
      }
      const res = await request(server);
      return parsePlan(await res.text());
    }
  };
};
