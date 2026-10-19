// Daemon: liefert Display und API aus, hält die Zustandsautomaten und meldet Änderungen per SSE.
// Ohne Abhängigkeiten, damit auf dem Pi kein npm install nötig ist.
const http = require("http");
const fs = require("fs");
const path = require("path");
const configStore = require("./config");
const createBackend = require("./backend");
const { createSystemAdapter } = require("./system");
const { createFrame } = require("./state");

const PORT = process.env.PORT || 8080;
const DEV = process.env.FRAME_ENV === "dev";
const ROOT = path.join(__dirname, "..");
const DISPLAY_DIR = path.join(ROOT, "display");
const DEBUG_DIR = path.join(ROOT, "debug");
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
const sim = { wrongPassword: false, noInternet: false, keyRejected: false, images: false };
const dev = { theme: null, clockOffsetMs: 0, plan: "data.json" };
const DEADLINE_PRESETS = {
  normal: { slideshowAfterMin: configStore.DEFAULTS.slideshowAfterMin, offAfterMin: configStore.DEFAULTS.offAfterMin },
  short: { slideshowAfterMin: 10 / 60, offAfterMin: 30 / 60 }
};

const system = createSystemAdapter({ dev: DEV, sim });
const frame = createFrame({
  system,
  backend: createBackend({ dev: DEV, sim }),
  config: configStore.load(),
  saveConfig: configStore.save,
  // Bis Phase 7 Bilder hochladen kann, simuliert die Dev-Leiste vorhandene Bilder.
  hasImages: () => sim.images
});

// --- SSE ---

const clients = new Set();

const message = () => JSON.stringify({ frame: frame.snapshot(), dev: DEV ? { ...dev, sim } : null });

function broadcast() {
  const data = `data: ${message()}\n\n`;
  for (const res of clients) res.write(data);
}

frame.on("change", broadcast);

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
  },
  clock: ({ now }) => { dev.clockOffsetMs = now ? Date.parse(now) - Date.now() : 0; },
  theme: ({ theme }) => { dev.theme = theme === "dark" || theme === "light" ? theme : null; },
  plan: ({ file }) => { if (listFixtures().includes(file)) dev.plan = file; }
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

// --- Routen ---

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

  if (pathname === "/events") return openEvents(req, res);
  if (pathname === "/health") return sendJson(res, 200, { ok: true });
  if (pathname === "/api/activity" && req.method === "POST") {
    frame.activity();
    return sendJson(res, 200, { ok: true });
  }
  // Bis Phase 6 kommen Plan und Wetter aus den Fixtures.
  if (pathname === "/api/plan") return sendFile(res, path.join(FIXTURE_DIR, dev.plan));
  if (pathname === "/api/weather") return sendFile(res, path.join(FIXTURE_DIR, "weather.json"));

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
