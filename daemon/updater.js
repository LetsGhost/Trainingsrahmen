// Update per Knopf: prüft per git fetch, ob der eingestellte Branch neue Commits hat, und startet
// scripts/self-update.sh (pull, update.sh, Neustart, Rückfall bei Fehler).
// Auf dem Pi läuft das Skript als eigene systemd-Unit, in der Entwicklung direkt per bash – dort aber nur,
// wenn FRAME_UPDATE_DIR ausdrücklich auf einen Test-Klon zeigt, damit nie ins Arbeitsverzeichnis gepullt wird.
const { execFile, execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { FrameError } = require("./errors");

const GIT_TIMEOUT_MS = 60 * 1000;
// So lange gilt ein Update ohne neue Statusmeldung als laufend.
const RUNNING_STALE_MS = 3 * 60 * 1000;

function createUpdater({ dev, rootDir, baseDir, dataDir, config, port }) {
  const updateDir = process.env.FRAME_UPDATE_DIR;
  const appDir = updateDir ?? rootDir;
  const statusFile = path.join(dataDir, "update.json");

  // Commit des laufenden Codes; /health meldet ihn, damit self-update.sh den Neustart prüfen kann.
  let commit = null;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir }).toString().trim();
  } catch {}

  function git(args) {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd: appDir, timeout: GIT_TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
        if (err) reject(new FrameError("GIT", stderr.trim().split("\n").pop() || err.message));
        else resolve(stdout.trim());
      });
    });
  }

  function lastRun() {
    try {
      return JSON.parse(fs.readFileSync(statusFile, "utf8"));
    } catch {
      return null;
    }
  }

  const isRunning = () => {
    const s = lastRun();
    return s?.state === "running" && Date.now() - s.at < RUNNING_STALE_MS;
  };

  function writeStatus(state, message) {
    fs.mkdirSync(dataDir, { recursive: true });
    const body = JSON.stringify({ state, message, at: Date.now(), from: commit ?? "", to: "" });
    fs.writeFileSync(statusFile + ".tmp", body);
    fs.renameSync(statusFile + ".tmp", statusFile);
  }

  return {
    commit: () => commit,

    status: () => ({ ...config.update, commit, lastRun: lastRun(), running: isRunning() }),

    // Neue Commits auf dem Branch, neueste zuerst.
    async check() {
      const { remote, branch } = config.update;
      await git(["fetch", "--quiet", remote, branch]);
      const current = await git(["rev-parse", "HEAD"]);
      const latest = await git(["rev-parse", "FETCH_HEAD"]);
      if (current === latest) return { remote, branch, current, latest, changes: [] };
      // Lokale Commits, die es auf dem Branch nicht gibt, würden git pull --ff-only scheitern lassen.
      const ahead = Number(await git(["rev-list", "--count", `${latest}..${current}`]));
      const log = await git(["log", "--format=%h %s", "-n", "20", `${current}..${latest}`]);
      return { remote, branch, current, latest, ahead, changes: log ? log.split("\n") : [] };
    },

    install() {
      if (isRunning()) throw new FrameError("BUSY", "Es läuft bereits ein Update");
      if (dev && !updateDir) {
        throw new FrameError("DEV_NO_UPDATE", "In der Entwicklung nur mit FRAME_UPDATE_DIR (Test-Klon), damit nicht in dieses Arbeitsverzeichnis gepullt wird");
      }
      const env = {
        FRAME_UPDATE_REMOTE: config.update.remote,
        FRAME_UPDATE_BRANCH: config.update.branch,
        FRAME_DATA: dataDir,
        FRAME_HEALTH_URL: `http://localhost:${port}/health`
      };
      writeStatus("running", "Gestartet");
      if (dev) {
        const log = fs.openSync(path.join(dataDir, "update.log"), "a");
        spawn("bash", [path.join(appDir, "scripts", "self-update.sh")], {
          cwd: appDir, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", log, log], windowsHide: true
        }).unref();
      } else {
        // Die Unit liest Branch und Pfade aus data/update.env (auch im Demo-Modus dort, nicht unter data/demo/).
        fs.writeFileSync(path.join(baseDir, "update.env"), Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
        spawn("systemctl", ["start", "--no-block", "trainingsrahmen-update.service"], { detached: true, stdio: "ignore" }).unref();
      }
    }
  };
}

module.exports = { createUpdater };
