#!/usr/bin/env bash
# Update per Knopf aus dem Admin-Bereich:
#   1. git fetch des eingestellten Branches; gibt es nichts Neues, Ende.
#   2. git pull --ff-only, danach scripts/update.sh aus dem neuen Stand ausführen.
#   3. Daemon neu starten und warten, bis /health den neuen Commit meldet.
#   4. Klappt 2 oder 3 nicht binnen 30 s, zurück auf den vorherigen Commit und Daemon neu starten.
# Läuft als eigene systemd-Unit (scripts/systemd/trainingsrahmen-update.service), damit der Neustart
# des Daemons dieses Skript nicht mit beendet. Den Fortschritt liest das Admin-Panel aus data/update.json.
set -uo pipefail

APP_DIR="${FRAME_UPDATE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${FRAME_DATA:-$APP_DIR/data}"
REMOTE="${FRAME_UPDATE_REMOTE:-origin}"
BRANCH="${FRAME_UPDATE_BRANCH:-master}"
HEALTH_URL="${FRAME_HEALTH_URL:-http://localhost:8080/health}"
RESTART_CMD="${FRAME_RESTART_CMD:-systemctl restart trainingsrahmen.service}"
HEALTH_TIMEOUT_S=30
STATUS_FILE="$DATA_DIR/update.json"

OLD=""
NEW=""

# Meldungen sind feste Texte ohne Anführungszeichen, daher reicht printf für das JSON.
status() {
  mkdir -p "$DATA_DIR"
  printf '{"state":"%s","message":"%s","at":%s,"from":"%s","to":"%s"}\n' \
    "$1" "$2" "$(date +%s)000" "$OLD" "$NEW" > "$STATUS_FILE.tmp"
  mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}

# Wartet, bis der Daemon antwortet und den erwarteten Commit meldet.
healthy() {
  node -e '
    const [url, commit, timeoutS] = process.argv.slice(1);
    const until = Date.now() + timeoutS * 1000;
    (async () => {
      while (Date.now() < until) {
        try {
          const h = await (await fetch(url, { signal: AbortSignal.timeout(2000) })).json();
          if (h.ok && h.commit === commit) process.exit(0);
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
      process.exit(1);
    })();
  ' "$HEALTH_URL" "$1" "$HEALTH_TIMEOUT_S"
}

rollback() {
  status running "Fehler, gehe zurück auf den vorherigen Stand"
  git reset --hard --quiet "$OLD"
  $RESTART_CMD
  if healthy "$OLD"; then
    status failed "$1. Zurück auf dem vorherigen Stand"
  else
    status failed "$1. Auch der vorherige Stand startet nicht"
  fi
  exit 1
}

cd "$APP_DIR" || { status failed "App-Verzeichnis fehlt"; exit 1; }
OLD="$(git rev-parse HEAD)"

status running "Suche nach Updates"
if ! git fetch --quiet "$REMOTE" "$BRANCH"; then
  status failed "git fetch fehlgeschlagen"
  exit 1
fi
if [ "$(git rev-parse HEAD)" = "$(git rev-parse FETCH_HEAD)" ]; then
  status current "Bereits aktuell"
  exit 0
fi

status running "Lade Update"
if ! git pull --ff-only --quiet "$REMOTE" "$BRANCH"; then
  status failed "git pull fehlgeschlagen, lokale Änderungen oder abweichender Verlauf"
  exit 1
fi
NEW="$(git rev-parse HEAD)"

status running "Führe Update-Skript aus"
if [ -f scripts/update.sh ] && ! bash scripts/update.sh; then
  rollback "Update-Skript fehlgeschlagen"
fi

status running "Starte neu"
$RESTART_CMD
if ! healthy "$NEW"; then
  rollback "Neuer Stand antwortet nicht binnen ${HEALTH_TIMEOUT_S} s"
fi
status done "Aktualisiert"
