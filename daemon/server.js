// Phase 1: liefert das Display und Fixture-Daten aus. Ohne Abhängigkeiten, damit auf dem Pi kein npm install nötig ist.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const ROOT = path.join(__dirname, "..");
const DISPLAY_DIR = path.join(ROOT, "display");
const FIXTURE_DIR = path.join(ROOT, "fixtures");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

const API = {
  "/api/plan": "data.json",
  "/api/weather": "weather.json"
};

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

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

  if (API[pathname]) return sendFile(res, path.join(FIXTURE_DIR, API[pathname]));
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end('{"ok":true}');
  }

  const rel = pathname === "/" || pathname === "/display" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.join(DISPLAY_DIR, rel);
  if (!file.startsWith(DISPLAY_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  sendFile(res, file);
}).listen(PORT, () => {
  console.log(`Trainingsrahmen läuft auf http://localhost:${PORT}`);
});
