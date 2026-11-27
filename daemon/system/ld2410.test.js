const test = require("node:test");
const assert = require("node:assert/strict");
const { createSensor, configCommands, validateSensor } = require("./ld2410");

const hex = s => Buffer.from(s.replace(/\s+/g, ""), "hex");
const ack = word => hex(`fdfcfbfa 0400 ${word} 0000 04030201`);
// Messwert: Ziel still (2), Bewegung 81 cm / 40, still 120 cm / 59, Ziel bei 120 cm.
const REPORT = hex("f4f3f2f1 0d00 02 aa 02 5100 28 7800 3b 7800 55 00 f8f7f6f5");

test("Befehle wie im Hi-Link-Handbuch", () => {
  const [enable, distance, sensitivity, end] = configCommands({ gates: 8, sensitivity: "mid" });
  assert.deepEqual(enable, hex("fdfcfbfa 0400 ff00 0100 04030201"));
  assert.deepEqual(distance, hex("fdfcfbfa 1400 6000 0000 08000000 0100 08000000 0200 05000000 04030201"));
  assert.deepEqual(sensitivity, hex("fdfcfbfa 1400 6400 0000 ffff0000 0100 28000000 0200 28000000 04030201"));
  assert.deepEqual(end, hex("fdfcfbfa 0200 fe00 04030201"));
});

test("0,75 m: 2 Tore, Tor 2 taub", () => {
  const cmds = configCommands({ gates: 1, sensitivity: "mid" });
  assert.equal(cmds.length, 5);
  assert.deepEqual(cmds[1], hex("fdfcfbfa 1400 6000 0000 02000000 0100 02000000 0200 05000000 04030201"));
  assert.deepEqual(cmds[3], hex("fdfcfbfa 1400 6400 0000 02000000 0100 64000000 0200 64000000 04030201"));
  assert.equal(configCommands({ gates: 2, sensitivity: "mid" }).length, 4);
});

test("Messwerte: in Stücken, mit Müll davor", () => {
  const sensor = createSensor(() => {});
  const stream = Buffer.concat([hex("00 f4 13 37"), REPORT]);
  sensor.push(stream.subarray(0, 9));
  assert.equal(sensor.latest(), null);
  sensor.push(stream.subarray(9));
  assert.equal(sensor.latest().target, 2);
  assert.equal(sensor.latest().distanceCm, 120);
});

test("configure: wartet je Befehl auf die Antwort", async () => {
  const sent = [];
  const sensor = createSensor(frame => {
    sent.push(frame);
    setImmediate(() => sensor.push(ack(frame.subarray(6, 8).toString("hex").replace(/^(..)00$/, "$101"))));
  });
  await sensor.configure({ gates: 4, sensitivity: "high" });
  assert.equal(sent.length, 4);
});

test("configure: ohne Antwort Fehler, danach Konfigurationsmodus verlassen", async () => {
  const sent = [];
  const sensor = createSensor(frame => sent.push(frame));
  await assert.rejects(sensor.configure({ gates: 4, sensitivity: "high" }), /antwortet nicht/);
  assert.equal(sent.at(-1).readUInt16LE(6), 0x00fe);
});

test("validateSensor", () => {
  assert.deepEqual(validateSensor({ gates: 6, sensitivity: "low" }), { gates: 6, sensitivity: "low" });
  assert.throws(() => validateSensor({ gates: 9, sensitivity: "low" }), /Reichweite/);
  assert.throws(() => validateSensor({ gates: 0, sensitivity: "low" }), /Reichweite/);
  assert.throws(() => validateSensor({ gates: 4, sensitivity: "max" }), /Empfindlichkeit/);
});
