// node --test daemon/
const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("events");
const { createFrame, validate, validateAthletept, SETUP } = require("./state");

const invalid = { code: "INVALID" };

test("validateAthletept", () => {
  assert.deepEqual(validateAthletept({ url: " https://a.de ", apiKey: "k" }), { url: "https://a.de", apiKey: "k" });
  assert.equal(validateAthletept({ url: "", apiKey: "" }), null);
  assert.equal(validateAthletept(undefined), null);
  assert.throws(() => validateAthletept({ url: "javascript:alert(1)", apiKey: "k" }), invalid);
  assert.throws(() => validateAthletept({ url: "https://a.de", apiKey: "" }), invalid);
});

test("validate", () => {
  const input = { wifi: { ssid: " Heim ", password: "pw" }, server: { url: "https://s.de", apiKey: "k" } };
  assert.deepEqual(validate(input), { wifi: { ssid: "Heim", password: "pw" }, server: { url: "https://s.de", apiKey: "k" }, athletept: null });
  assert.throws(() => validate({ ...input, wifi: { ssid: " " } }), invalid);
  assert.throws(() => validate({ ...input, server: { url: "ftp://s.de", apiKey: "k" } }), invalid);
  assert.throws(() => validate({ ...input, server: { url: "https://s.de", apiKey: "" } }), invalid);
});

test("Radar: Fristen ruhen, solange jemand da ist", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const system = {
    events: new EventEmitter(),
    connectWifi: async () => { throw new Error("kein WLAN"); },
    checkInternet: async () => false,
    readCpuTemp: async () => null,
    setBacklight: () => {},
    portalUrl: () => null,
    adminUrl: () => null,
    status: () => ({})
  };
  const config = { wifi: { ssid: "x" }, server: { url: "https://s.de" }, slideshowAfterMin: 1, offAfterMin: 2 };
  const frame = createFrame({ system, backend: {}, config, saveConfig: () => {}, hasImages: () => false });
  await frame.boot();
  assert.equal(frame.snapshot().setup, SETUP.OFFLINE);
  system.events.emit("presence", true);
  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(frame.snapshot().rest, "AKTIV");
  system.events.emit("presence", false);
  t.mock.timers.tick(60 * 1000);
  assert.equal(frame.snapshot().rest, "AUS");
});

test("Hotspot: Fehlstart wird nach 30 s wiederholt", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "error", () => {});
  let attempts = 0;
  const system = {
    events: new EventEmitter(),
    startHotspot: async () => {
      if (++attempts === 1) throw new Error("hostapd startet nicht");
      return { ssid: "Rahmen-TEST", password: "pw" };
    },
    portalUrl: () => "http://10.42.0.1/setup",
    adminUrl: () => null,
    status: () => ({})
  };
  const frame = createFrame({ system, backend: {}, config: { wifi: null, server: null }, saveConfig: () => {}, hasImages: () => false });
  await frame.boot();
  assert.equal(frame.snapshot().setup, null);
  t.mock.timers.tick(30 * 1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(frame.snapshot().setup, SETUP.HOTSPOT);
});
