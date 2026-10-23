// Zugriff auf die Trainings-Backends:
// - Sport-Analytics (config.server, Pflicht): GET {url}/data mit Header x-api-key.
// - AthletePT 3.0 (config.athletept, optional): GET {url}/api/v1/me/week und /me/plan mit Bearer-Key;
//   daemon/athletept.js baut daraus das Format des Sport-Analytics-Backends.
// Das Format der Antwort kennt nur display/js/adapter.js; hier wird nur geprüft, dass es nach einem Plan aussieht.
// In der Entwicklung kommen die Pläne aus den Fixtures, außer die Dev-Leiste schaltet „Echter Server“ ein.
const fs = require("fs");
const { FrameError } = require("./errors");
const athletept = require("./athletept");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const TIMEOUT_MS = 10000;
const KEY_REJECTED = () => new FrameError("KEY_REJECTED", "Server lehnt den API-Key ab");

async function get(url, headers) {
  let res;
  try {
    res = await fetch(url, {
      headers: { ...headers, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new FrameError("SERVER_UNREACHABLE", "Server nicht erreichbar");
  }
  if (res.status === 401 || res.status === 403) throw KEY_REJECTED();
  if (!res.ok) throw new FrameError("SERVER_ERROR", `Server antwortet mit ${res.status}`);
  return res.text();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new FrameError("BAD_DATA", "Server liefert kein gültiges JSON");
  }
}

function parsePlan(text) {
  const data = parseJson(text);
  if (!Array.isArray(data?.trainingsweek)) throw new FrameError("BAD_DATA", "Antwort enthält keinen Wochenplan");
  return data;
}

// Wer die volle Adresse mit „/data“ einträgt, soll nicht bei …/data/data landen.
const requestSports = ({ url, apiKey }) => get(url.replace(/\/+$/, "").replace(/\/data$/, "") + "/data", { "x-api-key": apiKey });

async function requestAthletept({ url, apiKey }) {
  const base = athletept.apiBase(url);
  const headers = { Authorization: `Bearer ${apiKey}` };
  const [week, plan] = await Promise.all([get(`${base}/me/week`, headers), get(`${base}/me/plan`, headers)]);
  return athletept.toTrainingsweek(parseJson(week), parseJson(plan));
}

// Fehler von AthletePT als solche kenntlich machen, damit klar ist, welcher Server streikt.
async function asAthletept(promise) {
  try {
    return await promise;
  } catch (err) {
    throw new FrameError(err.code ?? "UNKNOWN", `AthletePT: ${err.message}`);
  }
}

// fixture(): Pfad der Fixture, die die Dev-Leiste gewählt hat. athleteptFixture: Antworten von /me/week und /me/plan.
module.exports = function createBackend({ dev, sim, fixture, athleteptFixture }) {
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
      await requestSports(server);
    },

    async fetchPlan(server) {
      if (!live()) {
        await simulate();
        return parsePlan(fs.readFileSync(fixture(), "utf8"));
      }
      return parsePlan(await requestSports(server));
    },

    checkAthletept(server) {
      return asAthletept(live() ? requestAthletept(server) : simulate());
    },

    fetchAthletept(server) {
      if (live()) return asAthletept(requestAthletept(server));
      return asAthletept(simulate().then(() => {
        const { week, plan } = JSON.parse(fs.readFileSync(athleteptFixture, "utf8"));
        return athletept.toTrainingsweek(week, plan);
      }));
    }
  };
};
