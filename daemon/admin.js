// Admin-Bereich: Passwort (scrypt), Sitzungen per Cookie und die API des Panels.
// Das erste Passwort wird in SETUP_ADMIN mit dem Einmal-Code vom Display gesetzt; danach gilt der normale Login.
// Schreibende Anfragen verlangen JSON und das Cookie ist SameSite=Strict, damit fremde Seiten nichts auslösen können.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { FrameError } = require("./errors");
const { SETUP } = require("./state");

const COOKIE = "rahmen_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const MIN_PASSWORD = 8;
const MAX_FAILURES = 5;
const LOCK_MS = 30 * 1000;
const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search";

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const { hash } = hashPassword(password, stored.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(stored.hash, "hex"));
}

const sameText = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function checkNewPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new FrameError("INVALID", `Passwort braucht mindestens ${MIN_PASSWORD} Zeichen`);
  }
}

// „abcd1234efgh“ → „abcd ···· efgh“
const maskKey = key => (!key ? "nicht gesetzt" : key.length <= 8 ? "····" : `${key.slice(0, 4)} ···· ${key.slice(-4)}`);

// Sitzungen überleben einen Neustart des Daemons (z. B. nach einem Update). Gespeichert wird nur der
// SHA-256 des Tokens, damit die Datei allein nicht zum Anmelden reicht.
function createSessionStore(file) {
  const digest = token => crypto.createHash("sha256").update(token).digest("hex");
  let entries = {};
  try {
    entries = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const persist = () => {
    const now = Date.now();
    for (const [k, expires] of Object.entries(entries)) if (expires < now) delete entries[k];
    fs.writeFileSync(file + ".tmp", JSON.stringify(entries));
    fs.renameSync(file + ".tmp", file);
  };
  return {
    get: token => entries[digest(token)],
    set: (token, expires) => { entries[digest(token)] = expires; persist(); },
    delete: token => { if (token) { delete entries[digest(token)]; persist(); } },
    clear: () => { entries = {}; persist(); }
  };
}

function createAdmin({ config, saveConfig, frame, sync, slides, backend, updater, dataDir, http }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const sessions = createSessionStore(path.join(dataDir, "sessions.json"));
  let failures = 0;
  let lockedUntil = 0;

  // --- Sitzungen ---

  function sessionToken(req) {
    const match = (req.headers.cookie ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
    return match?.[1] ?? null;
  }

  function isAuthed(req) {
    const token = sessionToken(req);
    const expires = token && sessions.get(token);
    if (!expires) return false;
    if (expires < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  function startSession(res) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_MS);
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
  }

  function endSession(req, res) {
    sessions.delete(sessionToken(req));
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  }

  // Gegen Raten: nach 5 Fehlversuchen 30 s Sperre (für alle, der Rahmen hat nur einen Admin).
  function guard() {
    if (Date.now() < lockedUntil) throw new FrameError("LOCKED", "Zu viele Versuche. Bitte 30 Sekunden warten.");
  }

  function failed() {
    if (++failures >= MAX_FAILURES) {
      failures = 0;
      lockedUntil = Date.now() + LOCK_MS;
    }
  }

  function sessionState(req) {
    const setup = frame.snapshot().setup;
    if (setup === SETUP.ADMIN) return "setup";
    if (!config.admin) return "unavailable";
    return isAuthed(req) ? "ok" : "login";
  }

  // --- Einstellungen ---

  function settings() {
    return {
      wifi: config.wifi?.ssid ?? null,
      server: { url: config.server?.url ?? "", apiKey: maskKey(config.server?.apiKey) },
      location: config.location,
      display: config.display,
      deadlines: { slideshowAfterMin: config.slideshowAfterMin, offAfterMin: config.offAfterMin }
    };
  }

  // Jede Gruppe ist optional; geprüft wird alles, bevor etwas gespeichert wird.
  async function updateSettings(input) {
    const next = {};
    if (input.server) {
      const url = String(input.server.url ?? "").trim();
      const apiKey = String(input.server.apiKey ?? "").trim() || config.server?.apiKey;
      if (!/^https?:\/\/\S+$/i.test(url)) throw new FrameError("INVALID", "Server-URL muss mit http:// oder https:// beginnen");
      if (!apiKey) throw new FrameError("INVALID", "API-Key fehlt");
      await backend.check({ url, apiKey });
      next.server = { url, apiKey };
    }
    if (input.location) {
      const { name, lat, lon } = input.location;
      if (!String(name ?? "").trim() || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) {
        throw new FrameError("INVALID", "Ort ungültig");
      }
      next.location = { name: String(name).trim(), lat: Number(lat), lon: Number(lon) };
    }
    if (input.display) {
      const { theme, showWeather, showRecovery } = input.display;
      if (!["auto", "light", "dark"].includes(theme)) throw new FrameError("INVALID", "Erscheinungsbild ungültig");
      next.display = { theme, showWeather: Boolean(showWeather), showRecovery: Boolean(showRecovery) };
    }
    if (input.deadlines) {
      const slideshowAfterMin = Number(input.deadlines.slideshowAfterMin);
      const offAfterMin = Number(input.deadlines.offAfterMin);
      if (!(slideshowAfterMin >= 1 && slideshowAfterMin <= 120)) throw new FrameError("INVALID", "Slideshow nach 1–120 Minuten");
      if (!(offAfterMin > slideshowAfterMin && offAfterMin <= 600)) {
        throw new FrameError("INVALID", "Display aus muss nach der Slideshow liegen (höchstens 600 Minuten)");
      }
      next.deadlines = { slideshowAfterMin, offAfterMin };
    }

    if (next.server) config.server = next.server;
    if (next.location) config.location = next.location;
    if (next.display) config.display = next.display;
    if (next.deadlines) frame.setDeadlines(next.deadlines);
    saveConfig(config);
    if (next.server) sync.syncPlan();
    if (next.location) sync.syncWeather();
    frame.changed();
    return settings();
  }

  function status() {
    const f = frame.snapshot();
    let disk = null;
    try {
      const s = fs.statfsSync(dataDir);
      disk = Math.round((1 - s.bavail / s.blocks) * 100);
    } catch {}
    return {
      setup: f.setup,
      rest: f.rest,
      wifi: f.system.wifi,
      signal: f.system.signal,
      ip: f.system.ip,
      uptimeSec: Math.round(os.uptime()),
      cpuTemp: f.cpuTemp,
      diskUsedPercent: disk,
      sync: sync.status(),
      slides: slides.count()
    };
  }

  async function geocode(query) {
    const q = String(query ?? "").trim();
    if (q.length < 2) return [];
    const params = new URLSearchParams({ name: q, count: 6, language: "de", format: "json" });
    let res;
    try {
      res = await fetch(`${GEOCODE_API}?${params}`, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new FrameError("GEOCODE_UNREACHABLE", "Ortssuche nicht erreichbar");
    }
    if (!res.ok) throw new FrameError("GEOCODE_ERROR", `Ortssuche antwortet mit ${res.status}`);
    const data = await res.json();
    return (data.results ?? []).map(r => ({
      name: r.name,
      detail: [r.admin1, r.country].filter(Boolean).join(", "),
      lat: r.latitude,
      lon: r.longitude
    }));
  }

  // --- Routen ---

  // Antwortet auf eine Aktion; FrameErrors werden zu 400 bzw. 403/429.
  async function respond(res, fn) {
    try {
      http.sendJson(res, 200, (await fn()) ?? { ok: true });
    } catch (err) {
      const status = err.code === "LOCKED" ? 429 : err.code === "FORBIDDEN" ? 403 : err.code === "NOT_FOUND" ? 404 : 400;
      if (!(err instanceof FrameError)) console.error(err);
      http.sendJson(res, status, { error: err instanceof FrameError ? err.message : "Interner Fehler" });
    }
  }

  const isJson = req => (req.headers["content-type"] ?? "").startsWith("application/json");

  // Liefert true, wenn die Anfrage zum Admin-Bereich gehörte.
  function route(req, res, pathname) {
    if (pathname === "/admin") {
      http.sendStatic(res, http.ADMIN_DIR, "index.html");
      return true;
    }
    if (pathname.startsWith("/admin/")) {
      http.sendStatic(res, http.ADMIN_DIR, pathname.slice("/admin/".length));
      return true;
    }
    if (!pathname.startsWith("/api/admin/")) return false;

    const action = pathname.slice("/api/admin/".length);
    const method = req.method;

    if (action === "session" && method === "GET") {
      http.sendJson(res, 200, { state: sessionState(req) });
      return true;
    }
    if (method !== "GET" && action !== "slides" && !isJson(req)) {
      http.sendJson(res, 415, { error: "JSON erwartet" });
      return true;
    }

    if (action === "setup" && method === "POST") {
      respond(res, async () => {
        guard();
        const { code, password } = await http.readJson(req);
        if (frame.snapshot().setup !== SETUP.ADMIN) throw new FrameError("FORBIDDEN", "Das Passwort ist bereits gesetzt");
        if (!frame.adminCode() || !sameText(String(code ?? "").toUpperCase(), frame.adminCode())) {
          failed();
          throw new FrameError("FORBIDDEN", "Code stimmt nicht. Bitte den QR-Code auf dem Display neu scannen.");
        }
        checkNewPassword(password);
        config.admin = hashPassword(password);
        saveConfig(config);
        startSession(res);
        frame.adminCompleted();
      });
      return true;
    }
    if (action === "login" && method === "POST") {
      respond(res, async () => {
        guard();
        const { password } = await http.readJson(req);
        if (!verifyPassword(String(password ?? ""), config.admin)) {
          failed();
          throw new FrameError("FORBIDDEN", "Passwort falsch");
        }
        failures = 0;
        startSession(res);
      });
      return true;
    }
    if (action === "logout" && method === "POST") {
      endSession(req, res);
      http.sendJson(res, 200, { ok: true });
      return true;
    }

    // Ab hier nur mit gültiger Sitzung.
    if (!isAuthed(req)) {
      http.sendJson(res, 401, { error: "Nicht angemeldet" });
      return true;
    }

    if (action === "settings" && method === "GET") http.sendJson(res, 200, settings());
    else if (action === "settings" && method === "POST") respond(res, async () => updateSettings(await http.readJson(req)));
    else if (action === "status" && method === "GET") http.sendJson(res, 200, status());
    else if (action === "sync" && method === "POST") respond(res, async () => { await sync.syncAll(); return status(); });
    else if (action === "geocode" && method === "GET") {
      respond(res, () => geocode(new URL(req.url, "http://localhost").searchParams.get("q")));
    } else if (action === "password" && method === "POST") {
      respond(res, async () => {
        guard();
        const { current, next } = await http.readJson(req);
        if (!verifyPassword(String(current ?? ""), config.admin)) {
          failed();
          throw new FrameError("FORBIDDEN", "Aktuelles Passwort falsch");
        }
        checkNewPassword(next);
        config.admin = hashPassword(next);
        saveConfig(config);
        // Alle anderen Sitzungen beenden, diese neu starten.
        sessions.clear();
        startSession(res);
      });
    } else if (action === "update" && method === "GET") {
      http.sendJson(res, 200, updater.status());
    } else if (action === "update/check" && method === "POST") {
      respond(res, () => updater.check());
    } else if (action === "update/install" && method === "POST") {
      respond(res, () => { updater.install(); return updater.status(); });
    } else if (action === "wifi-reset" && method === "POST") {
      respond(res, async () => { await frame.reset({ keepAdmin: true }); });
    } else if (action === "slides" && method === "GET") {
      http.sendJson(res, 200, { slides: slides.list(), max: slides.MAX_SLIDES });
    } else if (action === "slides" && method === "POST") {
      respond(res, async () => {
        const name = slides.add(await http.readBody(req, slides.MAX_BYTES));
        frame.changed();
        return { name };
      });
    } else if (action.startsWith("slides/") && method === "DELETE") {
      respond(res, () => {
        slides.remove(action.slice("slides/".length));
        frame.changed();
      });
    } else {
      http.sendJson(res, 404, { error: "Unbekannt" });
    }
    return true;
  }

  return { route, isAuthed };
}

module.exports = { createAdmin, hashPassword, verifyPassword };
