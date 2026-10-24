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
