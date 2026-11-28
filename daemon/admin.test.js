// node --test daemon/
// Admin-Zugang gegen den echten Daemon (Dev-Modus, Mock-Adapter): Einmal-Code, Login-Sperre, Sitzung.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

test("Admin: Einmal-Code, Sperre nach 5 Fehlversuchen, Sitzung, Teil-Einstellungen", async t => {
  const port = String(20000 + Math.floor(Math.random() * 20000));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "rahmen-"));
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: port, FRAME_ENV: "dev", FRAME_DATA: data, FRAME_PORTAL_PORT: "" },
    stdio: "ignore"
  });
  t.after(() => {
    proc.kill();
    fs.rmSync(data, { recursive: true, force: true });
  });
  const url = p => `http://localhost:${port}${p}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(url("/health")); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  const post = (p, body, cookie) => fetch(url(p), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify(body)
  });

  assert.equal((await post("/api/debug", { action: "force", setup: "SETUP_ADMIN" })).status, 200);
  // Der Test läuft auf localhost und bekommt den Code wie das Display über /events.
  const events = await fetch(url("/events"));
  const reader = events.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  reader.cancel();
  const code = JSON.parse(first.match(/^data: (.*)$/m)[1]).frame.adminCode;
  assert.match(code, /^[A-Z2-9]{6}$/);

  assert.equal((await post("/api/admin/setup", { code: "AAAAAA", password: "geheim123" })).status, 403);
  assert.equal((await post("/api/admin/setup", { code, password: "kurz" })).status, 400);
  const setup = await post("/api/admin/setup", { code: code.toLowerCase(), password: "geheim123" });
  assert.equal(setup.status, 200);
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  assert.equal((await post("/api/admin/setup", { code, password: "anderes123" })).status, 403, "Code gilt nur einmal");

  assert.equal((await fetch(url("/api/admin/settings"))).status, 401);
  assert.equal((await fetch(url("/api/admin/settings"), { headers: { Cookie: cookie } })).status, 200);

  // Nur das geänderte Feld: Helligkeit und Sensor bleiben, wie sie waren.
  const saved = await post("/api/admin/settings", { display: { theme: "dark" } }, cookie);
  assert.equal(saved.status, 200);
  const s = await saved.json();
  assert.equal(s.display.theme, "dark");
  assert.equal(s.display.brightness, "high");
  assert.equal(s.display.showWeather, true, "fehlendes Feld bleibt an");
  assert.equal((await post("/api/admin/settings", { display: { theme: "pink" } }, cookie)).status, 400);

  // Sensor und Nachtruhe nur am Rahmen: Der Admin-Weg verwirft sie, der Rahmen prüft die Nachtruhe.
  assert.equal((await post("/api/admin/settings", { night: { from: 1, to: 5 }, sensor: { gates: 2 } }, cookie)).status, 200);
  const stored = () => JSON.parse(fs.readFileSync(path.join(data, "config.json"), "utf8"));
  assert.deepEqual(stored().night, { from: 22, to: 7 });
  assert.equal(stored().sensor.gates, 6);
  assert.equal((await post("/api/frame/settings", { night: { from: 5, to: 5 } })).status, 400);
  assert.equal((await post("/api/frame/settings", { night: { from: 1, to: 5 } })).status, 200);
  assert.deepEqual(stored().night, { from: 1, to: 5 });

  // Auto-Dunkel-Zeiten: gleiche Stunde abgelehnt, gültige werden gespeichert.
  assert.equal((await post("/api/frame/settings", { display: { darkFrom: 6, darkTo: 6 } })).status, 400);
  assert.equal((await post("/api/frame/settings", { display: { darkFrom: 20, darkTo: 7 } })).status, 200);
  assert.deepEqual([stored().display.darkFrom, stored().display.darkTo], [20, 7]);

  // Richtiges Passwort setzt den Zähler zurück; danach sperren 5 falsche auch das richtige.
  assert.equal((await post("/api/admin/login", { password: "geheim123" })).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await post("/api/admin/login", { password: "falsch" })).status, 403);
  assert.equal((await post("/api/admin/login", { password: "geheim123" })).status, 429);

  assert.equal((await post("/api/admin/logout", {}, cookie)).status, 200);
  assert.equal((await fetch(url("/api/admin/settings"), { headers: { Cookie: cookie } })).status, 401);
});
