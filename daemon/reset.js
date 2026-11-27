// Werkseinstellung und Demo-Schalter aus dem Admin-Bereich: ruft scripts/factory-reset.sh bzw. scripts/demo.sh auf.
// Die Skripte starten den Daemon neu oder stoppen ihn; darum laufen sie unter systemd in einer eigenen Unit
// (trainingsrahmen-reset.service), die Skript und Argumente aus data/reset.env liest.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { FrameError } = require("./errors");

const KINDS = {
  factory: ["factory-reset.sh", "-y"],
  "demo-fresh": ["demo.sh", "on --fresh"],
  "demo-off": ["demo.sh", "off"]
};

function createReset({ rootDir, baseDir, demo }) {
  return function run(kind) {
    if (!Object.hasOwn(KINDS, kind)) throw new FrameError("UNKNOWN", "Unbekannte Aktion");
    if (kind.startsWith("demo") !== demo) throw new FrameError("WRONG_MODE", demo ? "Im Demo-Modus nicht möglich" : "Nur im Demo-Modus");
    const [script, args] = KINDS[kind];
    // INVOCATION_ID setzt systemd für jeden Dienst.
    if (process.env.INVOCATION_ID) {
      fs.mkdirSync(baseDir, { recursive: true });
      fs.writeFileSync(path.join(baseDir, "reset.env"), `FRAME_RESET_SCRIPT=${script}\nFRAME_RESET_ARGS=${args}\n`);
      spawn("systemctl", ["start", "--no-block", "trainingsrahmen-reset.service"], { detached: true, stdio: "ignore" })
        .on("error", err => console.error("Reset-Unit:", err.message)).unref();
      return;
    }
    // shortcut: ohne systemd (PC) beendet sich der Daemon nach dem Skript und muss von Hand neu starten.
    spawn("bash", [path.join(rootDir, "scripts", script), ...args.split(" ")], { cwd: rootDir, stdio: "inherit", windowsHide: true })
      .on("error", err => console.error("Reset:", err.message))
      .on("exit", () => process.exit(0));
  };
}

module.exports = { createReset, KINDS };
