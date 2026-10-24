// node --test daemon/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

test("kaputtes %-Escape: 400, Daemon läuft weiter", async t => {
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
  assert.equal((await fetch(url("/%E0"))).status, 400);
  assert.equal((await fetch(url("/health"))).status, 200);
});
