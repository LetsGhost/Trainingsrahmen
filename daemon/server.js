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

const PORT = process.env.PORT || 8080;
const DEV = process.env.FRAME_ENV === "dev";
const ROOT = path.join(__dirname, "..");
const DISPLAY_DIR = path.join(ROOT, "display");
const DEBUG_DIR = path.join(ROOT, "debug");
const PORTAL_DIR = path.join(ROOT, "portal");
const FIXTURE_DIR = path.join(ROOT, "fixtures");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

// Fehlerschalter und Entwicklungs-Einstellungen; nur mit FRAME_ENV=dev änderbar.
// liveServer / liveWeather: echte Abrufe statt Fixtures.
const sim = { wrongPassword: false, noInternet: false, keyRejected: false, images: false, liveServer: false, liveWeather: false };
const dev = { theme: null, clockOffsetMs: 0, plan: "data.json" };
const DEADLINE_PRESETS = {
  normal: { slideshowAfterMin: configStore.DEFAULTS.slideshowAfterMin, offAfterMin: configStore.DEFAULTS.offAfterMin },
  short: { slideshowAfterMin: 10 / 60, offAfterMin: 30 / 60 }
};

const config = configStore.load();
const system = createSystemAdapter({ dev: DEV, sim, port: PORT });
const backend = createBackend({ dev: DEV, sim, fixture: () => path.join(FIXTURE_DIR, dev.plan) });
const frame = createFrame({
  system,
  backend,
  config,
  saveConfig: configStore.save,
  // Bis Phase 7 Bilder hochladen kann, simuliert die Dev-Leiste vorhandene Bilder.
  hasImages: () => sim.images
});

const sync = createSync({
  backend,
  weather: createWeather({ dev: DEV, sim, fixture: path.join(FIXTURE_DIR, "weather.json") }),
  config,
  dataDir: configStore.DATA_DIR,
  isOnline: () => frame.snapshot().setup === SETUP.READY
});

// Sobald der Rahmen online geht (nach Start, Einrichtung oder Ausfall), sofort abgleichen.
let lastSetup = null;
frame.on("change", f => {
  if (f.setup === SETUP.READY && lastSetup !== SETUP.READY) sync.syncAll();
  lastSetup = f.setup;
});

// --- SSE ---

const clients = new Set();

const message = () => JSON.stringify({ frame: frame.snapshot(), sync: sync.status(), dev: DEV ? { ...dev, sim } : null });

function broadcast() {
  const data = `data: ${message()}\n\n`;
  for (const res of clients) res.write(data);
}

frame.on("change", broadcast);
sync.on("change", broadcast);

// Kommentarzeile hält die Verbindung offen, falls ein Proxy sie sonst schließt.
setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 25000);

function openEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });
  res.write(`retry: 2000\ndata: ${message()}\n\n`);
  clients.add(res);
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

const listFixtures = () => fs.readdirSync(FIXTURE_DIR).filter(f => /^data.*\.json$/.test(f)).sort();

// --- Dev-Leiste ---

const DEBUG_ACTIONS = {
  motion: () => system.triggerMotion(),
  force: body => frame.force(body),
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
  return false;
}

// --- Routen ---

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

  if (routeSetup(req, res, pathname)) return;
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
