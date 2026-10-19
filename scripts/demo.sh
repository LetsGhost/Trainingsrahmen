#!/usr/bin/env bash
# Demo-Modus ein- und ausschalten: Der Rahmen startet ohne Einrichtung im Plan, mit Testplan und Testwetter
# aus fixtures/, WLAN und Internet werden nur gespielt (daemon/demo.js). Admin-Passwort „demo1234“.
# Einstellungen, Cache und Bilder liegen getrennt unter data/demo/; die echte Einrichtung bleibt erhalten.
#   ./scripts/demo.sh on [--fresh]   einschalten (--fresh: Demo-Daten vorher löschen)
#   ./scripts/demo.sh off            ausschalten, zurück zur echten Einrichtung
#   ./scripts/demo.sh status
# Der Schalter steht als FRAME_DEMO=1 in data/frame.env, die beide Dienste lesen. Werkseinstellung löscht ihn.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$DIR/data/frame.env"

is_on() { grep -qs '^FRAME_DEMO=1' "$ENV_FILE"; }

restart() {
  if command -v systemctl >/dev/null && systemctl list-unit-files trainingsrahmen.service >/dev/null 2>&1; then
    systemctl restart trainingsrahmen.service || sudo systemctl restart trainingsrahmen.service
    echo "Daemon neu gestartet."
  else
    echo "Kein systemd-Dienst gefunden. Am PC: npm run demo"
  fi
}

case "${1:-status}" in
  on)
    mkdir -p "$DIR/data"
    [ "${2:-}" = "--fresh" ] && rm -rf "$DIR/data/demo" && echo "Demo-Daten gelöscht."
    if ! is_on; then
      touch "$ENV_FILE"
      sed -i '/^FRAME_DEMO=/d' "$ENV_FILE"
      echo "FRAME_DEMO=1" >> "$ENV_FILE"
    fi
    echo "Demo-Modus an. Admin-Bereich: Passwort demo1234"
    restart
    ;;
  off)
    if is_on; then
      sed -i '/^FRAME_DEMO=/d' "$ENV_FILE"
    fi
    echo "Demo-Modus aus."
    restart
    ;;
  status)
    if is_on; then echo "Demo-Modus: an"; else echo "Demo-Modus: aus"; fi
    ;;
  *)
    echo "Aufruf: $0 on [--fresh] | off | status" >&2
    exit 1
    ;;
esac
