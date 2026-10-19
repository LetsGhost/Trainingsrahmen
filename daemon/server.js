// Daemon: liefert Display und API aus, hält die Zustandsautomaten und meldet Änderungen per SSE.
// Ohne Abhängigkeiten, damit auf dem Pi kein npm install nötig ist.
const http = require("http");
const fs = require("fs");
const path = require("path");
const configStore = require("./config");
const createBackend = require("./backend");
const createWeather = require("./weather");
const { createSync } = require("./sync");
const { createSystemAdapter } = require("./system");
const { createFrame, validate, SETUP } = require("./state");
const qr = require("./qr");
const { FrameError } = require("./errors");
const { createSlides } = require("./slides");
const { createAdmin } = require("./admin");

const PORT = process.env.PORT || 8080;
const DEV = process.env.FRAME_ENV === "dev";
const ROOT = path.join(__dirname, "..");
const DISPLAY_DIR = path.join(ROOT, "display");
const DEBUG_DIR = path.join(ROOT, "debug");
const PORTAL_DIR = path.join(ROOT, "portal");
const ADMIN_DIR = path.join(ROOT, "admin");
const FIXTURE_DIR = path.join(ROOT, "fixtures");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

// Fehlerschalter und Entwicklungs-Einstellungen; nur mit FRAME_ENV=dev änderbar.
// liveServer / liveWeather: echte Abrufe statt Fixtures.
const sim = { wrongPassword: false, noInternet: false, keyRejected: false, liveServer: false, liveWeather: false };
const dev = { theme: null, clockOffsetMs: 0, plan: "data.json" };
const DEADLINE_PRESETS = {
  normal: { slideshowAfterMin: configStore.DEFAULTS.slideshowAfterMin, offAfterMin: configStore.DEFAULTS.offAfterMin },
  short: { slideshowAfterMin: 10 / 60, offAfterMin: 30 / 60 }
};

const config = configStore.load();
const system = createSystemAdapter({ dev: DEV, sim, port: PORT });
const backend = createBackend({ dev: DEV, sim, fixture: () => path.join(FIXTURE_DIR, dev.plan) });
const slides = createSlides(configStore.DATA_DIR);
const frame = createFrame({
  system,
  backend,
  config,
  saveConfig: configStore.save,
  hasImages: () => slides.count() > 0
});

const sync = createSync({
  backend,
  weather: createWeather({ dev: DEV, sim, fixture: path.join(FIXTURE_DIR, "weather.json") }),
  config,
  dataDir: configStore.DATA_DIR,
  // Auch während des Admin-Schritts, damit der Plan danach sofort da ist.
  isOnline: () => [SETUP.READY, SETUP.ADMIN].includes(frame.snapshot().setup)
});

// Sobald der Rahmen online geht (nach Start, Einrichtung oder Ausfall), sofort abgleichen.
let lastSetup = null;
const ONLINE = [SETUP.READY, SETUP.ADMIN];
frame.on("change", f => {
  if (ONLINE.includes(f.setup) && !ONLINE.includes(lastSetup)) sync.syncAll();
  lastSetup = f.setup;
});

// --- SSE ---

// Anfragen vom Pi selbst (Display im Kiosk-Browser). Nur sie sehen den Einmal-Code für das Admin-Passwort.
const LOCAL = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const isLocal = req => LOCAL.has(req.socket.remoteAddress);

// res → lokal ja/nein
const clients = new Map();

function message(local) {
  const f = frame.snapshot();
  if (!local) f.adminCode = null;
  return JSON.stringify({ frame: f, sync: sync.status(), dev: DEV ? { ...dev, sim } : null });
}

function broadcast() {
  const data = { true: `data: ${message(true)}\n\n`, false: `data: ${message(false)}\n\n` };
  for (const [res, local] of clients) res.write(data[local]);
}

frame.on("change", broadcast);
sync.on("change", broadcast);

// Kommentarzeile hält die Verbindung offen, falls ein Proxy sie sonst schließt.
setInterval(() => { for (const res of clients.keys()) res.write(": ping\n\n"); }, 25000);

function openEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });
  res.write(`retry: 2000\ndata: ${message(isLocal(req))}\n\n`);
  clients.set(res, isLocal(req));
  req.on("close", () => clients.delete(res));
}

// --- Hilfen ---

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Nicht gefunden");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

function sendStatic(res, dir, rel) {
  const file = path.join(dir, rel);
  if (!file.startsWith(dir + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  sendFile(res, file);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    // Zu große Uploads werden zu Ende gelesen und verworfen, damit der Browser die Fehlermeldung noch bekommt.
    req.on("data", chunk => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > limit) reject(new FrameError("TOO_LARGE", "Datei ist zu groß"));
      else resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

const admin = createAdmin({
  config,
  saveConfig: configStore.save,
  frame,
  sync,
  slides,
  backend,
  dataDir: configStore.DATA_DIR,
  http: { sendJson, sendStatic, readJson, readBody, ADMIN_DIR }
});

const listFixtures = () => fs.readdirSync(FIXTURE_DIR).filter(f => /^data.*\.json$/.test(f)).sort();

// --- Dev-Leiste ---

const DEBUG_ACTIONS = {
  motion: () => system.triggerMotion(),
  // OFFLINE und READY erzwingen setzt „Kein Internet“ passend, damit die Verbindungsprüfung den Zustand hält.
  force: body => {
    if (body.setup === "OFFLINE") sim.noInternet = true;
    if (body.setup === "READY" || body.setup === "SETUP_ADMIN") sim.noInternet = false;
    return frame.force(body);
  },
  reset: () => frame.reset(),
  portal: () => frame.portalOpened(),
  submit: body => frame.submit(body),
  deadlines: ({ preset }) => DEADLINE_PRESETS[preset] && frame.setDeadlines(DEADLINE_PRESETS[preset]),
  sim: ({ key, value }) => {
    if (!(key in sim)) return;
    sim[key] = Boolean(value);
    if (key === "noInternet") frame.check();
    if (key === "liveServer" || key === "keyRejected") sync.syncPlan();
    if (key === "liveWeather") sync.syncWeather();
  },
  sync: () => sync.syncAll(),
  clock: ({ now }) => { dev.clockOffsetMs = now ? Date.parse(now) - Date.now() : 0; },
  theme: ({ theme }) => { dev.theme = theme === "dark" || theme === "light" ? theme : null; },
  plan: ({ file }) => {
    if (!listFixtures().includes(file)) return;
    dev.plan = file;
    return sync.syncPlan();
  }
};

async function handleDebug(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: "Ungültiges JSON" });
  }
  const action = DEBUG_ACTIONS[body.action];
  if (!action) return sendJson(res, 404, { error: `Unbekannte Aktion: ${body.action}` });
  try {
    await action(body);
  } catch (err) {
    return sendJson(res, 409, { error: err.message });
  }
  broadcast();
  sendJson(res, 200, { ok: true });
}

// --- Einrichtung (Captive Portal) ---

const inSetup = () => {
  const f = frame.snapshot();
  return (f.setup === SETUP.HOTSPOT || f.setup === SETUP.ACCOUNT) && !f.connecting;
};

// Prüfadressen, mit denen Android, iOS und Windows nach einem Captive Portal suchen.
const CAPTIVE_PROBES = new Set([
  "/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
  "/connecttest.txt", "/ncsi.txt", "/redirect", "/success.txt", "/canonical.html"
]);

function redirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function sendSvg(res, svg) {
  res.writeHead(200, { "Content-Type": MIME[".svg"], "Cache-Control": "no-store" });
  res.end(svg);
}

async function handleSetupSubmit(req, res) {
  let input;
  try {
    input = validate(await readJson(req));
  } catch (err) {
    return sendJson(res, 400, { error: err.code === "INVALID" ? err.message : "Ungültige Eingabe" });
  }
  if (!inSetup()) return sendJson(res, 409, { error: "Keine Einrichtung aktiv" });
  // Erst antworten, dann verbinden: Sobald der Hotspot schließt, verliert das Handy die Verbindung.
  sendJson(res, 202, { ok: true });
  frame.submit(input).catch(err => console.error(err));
}

// Liefert true, wenn die Anfrage zur Einrichtung gehörte.
function routeSetup(req, res, pathname) {
  // Während der Einrichtung führt jede Prüfadresse (und auf dem Pi jeder fremde Host) zum Portal.
  const foreignHost = !DEV && req.headers.host && !/^(localhost|127\.0\.0\.1|10\.42\.0\.1|rahmen\.local)(:\d+)?$/.test(req.headers.host);
  if (inSetup() && (CAPTIVE_PROBES.has(pathname) || foreignHost)) {
    redirect(res, system.portalUrl());
    return true;
  }
  if (pathname === "/setup") {
    frame.portalOpened();
    sendStatic(res, PORTAL_DIR, "index.html");
    return true;
  }
  if (pathname.startsWith("/setup/")) {
    sendStatic(res, PORTAL_DIR, pathname.slice("/setup/".length));
    return true;
  }
  if (pathname === "/api/setup" && req.method === "POST") {
    handleSetupSubmit(req, res);
    return true;
  }
  if (pathname === "/api/setup/networks") {
    if (!inSetup()) sendJson(res, 409, { error: "Keine Einrichtung aktiv" });
    else system.scanWifi().then(list => sendJson(res, 200, list), err => sendJson(res, 500, { error: err.message }));
    return true;
  }
  if (pathname === "/api/setup/qr/wifi.svg") {
    const { hotspot } = frame.snapshot();
    if (hotspot) sendSvg(res, qr.toSvg(qr.wifiPayload(hotspot)));
    else sendJson(res, 404, { error: "Kein Hotspot aktiv" });
    return true;
  }
  if (pathname === "/api/setup/qr/portal.svg") {
    sendSvg(res, qr.toSvg(system.portalUrl()));
    return true;
  }
  // Admin-QR mit Einmal-Code: nur für das Display auf dem Pi.
  if (pathname === "/api/setup/qr/admin.svg") {
    const code = frame.adminCode();
    if (code && isLocal(req)) sendSvg(res, qr.toSvg(`${system.adminUrl()}?code=${code}`));
    else sendJson(res, 404, { error: "Kein Admin-Code aktiv" });
    return true;
  }
  return false;
}

// --- Routen ---

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

  if (routeSetup(req, res, pathname)) return;
  if (admin.route(req, res, pathname)) return;
  // Slideshow-Bilder: für das Display und angemeldete Admins.
  if (pathname === "/api/slides" || pathname.startsWith("/api/slides/")) {
    if (!isLocal(req) && !admin.isAuthed(req)) return sendJson(res, 401, { error: "Nicht angemeldet" });
    if (pathname === "/api/slides") return sendJson(res, 200, slides.list());
    const file = slides.file(pathname.slice("/api/slides/".length));
    return file ? sendFile(res, file) : sendJson(res, 404, { error: "Nicht gefunden" });
  }
  if (pathname === "/events") return openEvents(req, res);
  if (pathname === "/health") return sendJson(res, 200, { ok: true });
  if (pathname === "/api/activity" && req.method === "POST") {
    frame.activity();
    return sendJson(res, 200, { ok: true });
  }
  // Letzter Stand aus dem Sync; Plan im Server-Format (übersetzt wird im Display), Wetter schon übersetzt.
  if (pathname === "/api/plan" || pathname === "/api/weather") {
    const data = pathname === "/api/plan" ? sync.plan() : sync.weather();
    return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "Noch kein Stand" });
  }

  if (DEV) {
    if (pathname === "/api/debug" && req.method === "POST") return handleDebug(req, res);
    if (pathname === "/api/debug/fixtures") return sendJson(res, 200, listFixtures());
    if (pathname === "/debug") return sendStatic(res, DEBUG_DIR, "index.html");
    if (pathname.startsWith("/debug/")) return sendStatic(res, DEBUG_DIR, pathname.slice("/debug/".length));
  }

  const rel = pathname === "/" || pathname === "/display" ? "index.html" : pathname.replace(/^\/+/, "");
  sendStatic(res, DISPLAY_DIR, rel);
}).listen(PORT, () => {
  console.log(`Trainingsrahmen läuft auf http://localhost:${PORT}${DEV ? ` (Dev-Leiste: http://localhost:${PORT}/debug)` : ""}`);
  frame.boot();
});
