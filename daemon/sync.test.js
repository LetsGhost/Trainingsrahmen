// node --test daemon/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSync } = require("./sync");

test("Garmin-Erholung nur vom heutigen Abruf", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rahmen-sync-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "cache"));
  const write = (name, entry) => fs.writeFileSync(path.join(dir, "cache", `${name}.json`), JSON.stringify(entry));
  const plan = { trainingsweek: [], recovery: { score: 50 } };
  write("plan", { fetchedAt: Date.now(), data: plan });

  const load = () => createSync({ backend: {}, weather: {}, config: { garmin: { apiKey: "k" } }, dataDir: dir, isOnline: () => false }).plan();

  write("garmin", { fetchedAt: Date.now(), data: { recovery: { hrv: 60 } } });
  assert.deepEqual(load().recovery, { score: 50, hrv: 60 });

  write("garmin", { fetchedAt: Date.now() - 36 * 3600 * 1000, data: { recovery: { hrv: 60 } } });
  assert.deepEqual(load().recovery, { score: 50 });
});
