#!/usr/bin/env bash
# Vom PC aus (Git Bash): bringt den aktuellen Arbeitsstand per SSH auf den Pi, ohne Commit, und startet neu.
# Kopiert werden alle Dateien, die git kennt oder nicht ignoriert (auch ungespeicherte Änderungen); data/ bleibt.
#   ./scripts/deploy.sh                  an admin@rahmen.local (oder $FRAME_PI)
#   ./scripts/deploy.sh admin@10.0.0.7   an eine andere Adresse
#   ./scripts/deploy.sh --restore        auf dem Pi zurück auf den committeten Stand (git checkout + clean)
# Der Pi muss einmal mit scripts/setup-pi.sh eingerichtet sein. Solange dort Änderungen von deploy.sh liegen,
# scheitert der Update-Knopf (git pull --ff-only) absichtlich – erst --restore, dann geht er wieder.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${FRAME_PI:-admin@rahmen.local}"
REMOTE_DIR="trainingsrahmen"
RESTORE=0
for arg in "$@"; do
  case "$arg" in
    --restore) RESTORE=1 ;;
    -*) echo "Unbekannte Option: $arg" >&2; exit 1 ;;
    *) HOST="$arg" ;;
  esac
done

step() { echo; echo "==> $*"; }

# Mehrere SSH-Aufrufe: Mit SSH-Key (einmal ssh-copy-id) fragt keiner nach dem Passwort.
SSH=(ssh -o ConnectTimeout=10)
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

step "Verbinde mit $HOST"
if ! "${SSH[@]}" "$HOST" "test -d ~/$REMOTE_DIR/.git"; then
  echo "Auf $HOST fehlt ~/$REMOTE_DIR. Erst einrichten (siehe scripts/setup-pi.sh)." >&2
  exit 1
fi

if [ "$RESTORE" -eq 1 ]; then
  step "Zurück auf den committeten Stand"
  "${SSH[@]}" "$HOST" "cd ~/$REMOTE_DIR && git checkout -- . && git clean -fd && git log --oneline -1"
else
  step "Kopiere Arbeitsstand ($(git -C "$DIR" rev-parse --short HEAD)$(git -C "$DIR" diff --quiet HEAD || echo ' + Änderungen'))"
  # Nur Dateien, die es gibt (gelöschte, aber noch nicht committete fallen raus).
  (
    cd "$DIR"
    git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' f; do
      [ -f "$f" ] && printf '%s\0' "$f"
    done | tar --null -T - -cf -
  ) | tar -xf - -C "$STAGE"
  # Der Windows-Checkout hat CRLF (core.autocrlf), im Repo steht LF. Ohne Umwandlung gilt auf dem Pi jede
  # Datei als geändert. grep -I listet nur Textdateien, Schrift und Bilder bleiben unberührt.
  grep -rIl '' "$STAGE" | while IFS= read -r f; do sed -i 's/\r$//' "$f"; done
  tar -czf - -C "$STAGE" . | "${SSH[@]}" "$HOST" \
    "tar -xzf - -C ~/$REMOTE_DIR && chmod +x ~/$REMOTE_DIR/scripts/*.sh && cd ~/$REMOTE_DIR && git status --short"
fi

step "Dienste installieren und neu starten"
"${SSH[@]}" -t "$HOST" "cd ~/$REMOTE_DIR && ./scripts/install-services.sh"

step "Warte auf den Daemon"
for _ in $(seq 1 30); do
  if health="$("${SSH[@]}" "$HOST" "curl -fs --max-time 2 http://localhost:8080/health" 2>/dev/null)"; then
    echo "$health"
    echo "Fertig. Logs: ssh $HOST journalctl -u trainingsrahmen -f"
    exit 0
  fi
  sleep 1
done
echo "Daemon antwortet nicht. Logs: ssh $HOST journalctl -u trainingsrahmen -n 50" >&2
exit 1
