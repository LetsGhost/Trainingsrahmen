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
  // Zugänge im Portal-Input werden ignoriert, die gibt es nur im Admin-Bereich.
  const input = { wifi: { ssid: " Heim ", password: "pw" }, server: { url: "https://s.de", apiKey: "k" } };
  assert.deepEqual(validate(input), { wifi: { ssid: "Heim", password: "pw" } });
  assert.throws(() => validate({ ...input, wifi: { ssid: " " } }), invalid);
});

test("Einrichtung nur mit WLAN; WLAN ändern behält die Zugänge", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const system = {
    events: new EventEmitter(),
    startHotspot: async () => ({ ssid: "Rahmen-TEST", password: "pw" }),
    stopHotspot: async () => {},
    connectWifi: async () => {},
    checkInternet: async () => true,
    portalUrl: () => null,
    adminUrl: () => null,
    status: () => ({})
  };
  const server = { url: "https://s.de", apiKey: "k" };
  const config = { wifi: null, server, admin: { salt: "s", hash: "h" }, slideshowAfterMin: 1, offAfterMin: 2 };
  const frame = createFrame({ system, config, saveConfig: () => {}, hasImages: () => false });
  await frame.boot();
  await frame.submit({ wifi: { ssid: "Heim", password: "pw" } });
  assert.equal(frame.snapshot().setup, SETUP.READY);
  assert.deepEqual(config.wifi, { ssid: "Heim", password: "pw" });
  // Passwort vergessen: zurück nach SETUP_ADMIN mit neuem Einmal-Code, Zugänge bleiben.
  frame.resetAdmin();
  assert.equal(config.admin, null);
  assert.equal(frame.snapshot().setup, SETUP.ADMIN);
  assert.ok(frame.adminCode());
  assert.equal(config.server, server);
  config.admin = { salt: "s", hash: "h" };
  frame.adminCompleted();
  assert.equal(frame.snapshot().setup, SETUP.READY);
  await frame.reset({ keepAdmin: true });
  assert.equal(config.wifi, null);
  assert.equal(config.server, server);
  await frame.reset();
  assert.equal(config.server, null);
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
  const frame = createFrame({ system, config, saveConfig: () => {}, hasImages: () => false });
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
  const frame = createFrame({ system, config: { wifi: null, server: null }, saveConfig: () => {}, hasImages: () => false });
  await frame.boot();
  assert.equal(frame.snapshot().setup, null);
  t.mock.timers.tick(30 * 1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(frame.snapshot().setup, SETUP.HOTSPOT);
});
