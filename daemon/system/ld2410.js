// HLK-LD2410(C) über die serielle Schnittstelle (256000 Baud, 8N1), nach Hi-Link „LD2410 Serial Communication Protocol“.
// Befehle: FD FC FB FA · Länge (2, LE) · Befehlswort (2, LE) · Wert · 04 03 02 01. Die Antwort trägt Befehlswort | 0x0100.
// Messwerte (rund 10 pro Sekunde): F4 F3 F2 F1 · Länge · Daten · F8 F7 F6 F5.
// Der OUT-Pin (gpiomon in pi.js) meldet weiter die Anwesenheit; hier geht es nur ums Einstellen und die Live-Anzeige.
const { FrameError } = require("../errors");

const CMD_HEAD = Buffer.from([0xfd, 0xfc, 0xfb, 0xfa]);
const CMD_TAIL = Buffer.from([0x04, 0x03, 0x02, 0x01]);
const REP_HEAD = Buffer.from([0xf4, 0xf3, 0xf2, 0xf1]);
const REP_TAIL = Buffer.from([0xf8, 0xf7, 0xf6, 0xf5]);

// Ein Entfernungstor („Gate“) ist 0,75 m breit; der Sensor nimmt 2–8 Tore (1,5–6 m). Kürzer (1 Tor = 0,75 m)
// geht über 2 Tore, bei denen die überzähligen Tore die Schwelle 100 bekommen und damit praktisch nichts melden.
const GATE_M = 0.75;
const MIN_GATES = 1;
const SENSOR_MIN_GATES = 2;
const MAX_GATES = 8;
const DEAF = 100;
// Nachlaufzeit im Sensor; die Ruhe-Fristen des Rahmens kommen obendrauf, daher kurz.
const HOLD_S = 5;
// Schwellwert der Energie (0–100) für alle Tore: kleiner = empfindlicher. Werkseinstellung liegt bei 15–50.
// shortcut: Werte geschätzt, am Pi mit still sitzender und bewegter Person nachmessen.
const SENSITIVITY = { low: { moving: 60, still: 60 }, mid: { moving: 40, still: 40 }, high: { moving: 25, still: 25 } };
const ACK_TIMEOUT_MS = 1000;

function command(word, value = Buffer.alloc(0)) {
  const len = Buffer.alloc(2);
  len.writeUInt16LE(2 + value.length);
  const cmd = Buffer.alloc(2);
  cmd.writeUInt16LE(word);
  return Buffer.concat([CMD_HEAD, len, cmd, value, CMD_TAIL]);
}

// Je Paar: Parameterwort (2 Bytes) und Wert (4 Bytes).
function params(pairs) {
  const buf = Buffer.alloc(pairs.length * 6);
  pairs.forEach(([word, value], i) => {
    buf.writeUInt16LE(word, i * 6);
    buf.writeUInt32LE(value, i * 6 + 2);
  });
  return buf;
}

function validateSensor(input) {
  const gates = Number(input?.gates);
  if (!Number.isInteger(gates) || gates < MIN_GATES || gates > MAX_GATES) throw new FrameError("INVALID", "Reichweite ungültig");
  if (!(input.sensitivity in SENSITIVITY)) throw new FrameError("INVALID", "Empfindlichkeit ungültig");
  return { gates, sensitivity: input.sensitivity };
}

// Konfigurationsmodus an, Reichweite + Nachlaufzeit, Schwellen für alle Tore (0xFFFF), bei kurzer Reichweite
// die überzähligen Tore taub, Konfigurationsmodus aus.
function configCommands({ gates, sensitivity }) {
  const s = SENSITIVITY[sensitivity];
  const max = Math.max(gates, SENSOR_MIN_GATES);
  const deaf = [];
  for (let g = gates + 1; g <= max; g++) deaf.push(command(0x0064, params([[0, g], [1, DEAF], [2, DEAF]])));
  return [
    command(0x00ff, Buffer.from([0x01, 0x00])),
    command(0x0060, params([[0, max], [1, max], [2, HOLD_S]])),
    command(0x0064, params([[0, 0xffff], [1, s.moving], [2, s.still]])),
    ...deaf,
    command(0x00fe)
  ];
}

// target: 0 niemand, 1 Bewegung, 2 still, 3 beides. distanceCm: Entfernung des erkannten Ziels.
function parseReport(data) {
  if (data.length < 11 || data[1] !== 0xaa) return null;
  return { target: data[2], distanceCm: data.readUInt16LE(9) };
}

// Zerlegt den Bytestrom in Rahmen; Müll davor und kaputte Rahmen werden übersprungen.
function createParser({ onAck, onReport }) {
  let buf = Buffer.alloc(0);
  return function push(chunk) {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const c = buf.indexOf(CMD_HEAD), r = buf.indexOf(REP_HEAD);
      const start = c < 0 ? r : r < 0 ? c : Math.min(c, r);
      if (start < 0) {
        buf = buf.subarray(Math.max(0, buf.length - 3));
        return;
      }
      buf = buf.subarray(start);
      if (buf.length < 6) return;
      const total = 6 + buf.readUInt16LE(4) + 4;
      // Längenfeld unplausibel: kein echter Rahmenanfang.
      if (total > 64) {
        buf = buf.subarray(1);
        continue;
      }
      if (buf.length < total) return;
      const isAck = buf.subarray(0, 4).equals(CMD_HEAD);
      const data = buf.subarray(6, total - 4);
      if (buf.subarray(total - 4, total).equals(isAck ? CMD_TAIL : REP_TAIL)) {
        if (isAck && data.length >= 4) onAck(data.readUInt16LE(0), data.readUInt16LE(2));
        else if (!isAck) {
          const report = parseReport(data);
          if (report) onReport(report);
        }
        buf = buf.subarray(total);
      } else buf = buf.subarray(1);
    }
  };
}

// write(buffer) schickt Bytes zum Sensor; push(chunk) bekommt alles, was zurückkommt.
function createSensor(write) {
  let pending = null;
  let queue = Promise.resolve();
  let latest = null;

  const push = createParser({
    onAck(word, status) {
      if (!pending || word !== (pending.word | 0x0100)) return;
      clearTimeout(pending.timer);
      const p = pending;
      pending = null;
      status === 0 ? p.resolve() : p.reject(new FrameError("SENSOR_FAILED", "Sensor lehnt die Einstellung ab"));
    },
    onReport(report) {
      latest = { ...report, at: Date.now() };
    }
  });

  function send(frame) {
    return new Promise((resolve, reject) => {
      const word = frame.readUInt16LE(6);
      const timer = setTimeout(() => {
        pending = null;
        reject(new FrameError("SENSOR_FAILED", "Sensor antwortet nicht"));
      }, ACK_TIMEOUT_MS);
      pending = { word, resolve, reject, timer };
      write(frame);
    });
  }

  async function apply(settings) {
    const commands = configCommands(settings);
    try {
      for (const frame of commands) await send(frame);
    } catch (err) {
      // Im Konfigurationsmodus schickt der Sensor keine Messwerte mehr; also auf jeden Fall verlassen.
      await send(commands[commands.length - 1]).catch(() => {});
      throw err;
    }
  }

  return {
    push,
    // Nacheinander, damit sich zwei Speichervorgänge nicht in die Antworten fahren.
    configure: settings => (queue = queue.catch(() => {}).then(() => apply(settings))),
    latest: () => latest
  };
}

module.exports = { createSensor, createParser, configCommands, command, validateSensor, GATE_M, MIN_GATES, MAX_GATES };
