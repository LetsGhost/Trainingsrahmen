// Zugriff auf die Trainings-Backends:
// - Sport-Analytics (config.server, Pflicht): GET {url}/data mit Header x-api-key.
// - AthletePT 3.0 (config.athletept, optional): GET {url}/api/v1/me/week und /me/plan mit Bearer-Key;
//   daemon/athletept.js baut daraus das Format des Sport-Analytics-Backends.
// - Garmin Personal API (config.garmin, optional): Schlaf, HRV, Ruhepuls und Body Battery, siehe daemon/garmin.js.
// Das Format der Antwort kennt nur display/js/adapter.js; hier wird nur geprüft, dass es nach einem Plan aussieht.
// In der Entwicklung kommen die Pläne aus den Fixtures, außer die Dev-Leiste schaltet „Echter Server“ ein.
const fs = require("fs");
const { FrameError } = require("./errors");
const athletept = require("./athletept");
const garmin = require("./garmin");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const TIMEOUT_MS = 10000;
const KEY_REJECTED = () => new FrameError("KEY_REJECTED", "Server lehnt den API-Key ab");

async function get(url, headers, method = "GET") {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Accept: "application/json", ...headers },
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

// Garmin hat für einen Tag ohne Daten keinen Inhalt (204) oder einen leeren.
const parseOptional = text => (text.trim() ? parseJson(text) : null);

// Token im Speicher; neu getauscht wird, wenn es in weniger als einer Stunde abläuft oder der Key wechselt.
let garminToken = null;
async function bearerToken(apiKey) {
  if (garminToken?.apiKey === apiKey && garminToken.expiresAt - Date.now() > 60 * 60 * 1000) return garminToken.token;
  // Das Token kommt als reiner Text; mit Accept: application/json antwortet Garmin 406.
  const token = (await get(garmin.TOKEN_URL, { Authorization: `ApiKey ${apiKey}`, Accept: "*/*" }, "POST")).trim();
  const expiresAt = garmin.tokenExpiry(token);
  if (!expiresAt) throw new FrameError("BAD_DATA", "Server liefert kein gültiges Token");
  garminToken = { apiKey, token, expiresAt };
  return token;
}

// hrvHistory: HRV-Verlauf aus dem Cache; zusätzlich geholt werden nur die Vortage, die dort fehlen.
async function requestGarmin({ apiKey }, hrvHistory) {
  const headers = { Authorization: `Bearer ${await bearerToken(apiKey)}` };
  const now = new Date();
  const entries = Object.entries(garmin.urls(now));
  const missing = garmin.missingHrvDays(hrvHistory, now);
  try {
    const [texts, past] = await Promise.all([
      Promise.all(entries.map(([, url]) => get(url, headers))),
      Promise.all(missing.map(date => get(garmin.hrvUrl(date), headers)))
    ]);
    const responses = Object.fromEntries(entries.map(([name], i) => [name, parseOptional(texts[i])]));
    const fetched = Object.fromEntries(missing.map((date, i) => [date, garmin.hrvOf(parseOptional(past[i]))]));
    fetched[garmin.today(now)] = garmin.hrvOf(responses.hrv);
    return garmin.toGarmin(responses, garmin.toHrvHistory(hrvHistory, fetched, now));
  } catch (err) {
    // Ein abgelehntes Token beim nächsten Abruf neu tauschen.
    if (err.code === "KEY_REJECTED") garminToken = null;
    throw err;
  }
}

// Fehler der Zusatzquellen als solche kenntlich machen, damit klar ist, welcher Server streikt.
const labeled = label => async promise => {
  try {
    return await promise;
  } catch (err) {
    throw new FrameError(err.code ?? "UNKNOWN", `${label}: ${err.message}`);
  }
};
const asAthletept = labeled("AthletePT");
const asGarmin = labeled("Garmin");

// fixture(): Pfad der Fixture, die die Dev-Leiste gewählt hat. athleteptFixture: Antworten von /me/week und /me/plan.
// garminFixture: Antworten von dailySleep, hrv, usersummary/daily und der Aktivitätssuche als
// { sleep, hrv, summary, activities, hrvPast }; die Aktivitäten werden auf die laufende Woche gelegt,
// hrvPast (HRV der 6 Vortage, ältester zuerst) auf die Tage vor heute.
module.exports = function createBackend({ dev, sim, fixture, athleteptFixture, garminFixture }) {
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
    },

    // Prüfen und Abrufen sind dasselbe: Token tauschen und die heutigen Werte holen.
    // Eigener Schalter, damit echtes Garmin auch ohne echten Sport-Analytics-Server geht.
    fetchGarmin(server, hrvHistory) {
      if (!dev || sim.liveGarmin) return asGarmin(requestGarmin(server, hrvHistory));
      return asGarmin(simulate().then(() => {
        const fx = JSON.parse(fs.readFileSync(garminFixture, "utf8"));
        const past = garmin.missingHrvDays(null).map((date, i) => [date, fx.hrvPast?.[i] ?? null]);
        const fetched = Object.fromEntries([...past, [garmin.today(), garmin.hrvOf(fx.hrv)]]);
        const data = garmin.toGarmin(fx, garmin.toHrvHistory(null, fetched));
        return { ...data, activities: garmin.toThisWeek(data.activities) };
      }));
    }
  };
};
