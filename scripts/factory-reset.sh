#!/usr/bin/env bash
# Setzt den Rahmen auf Werkseinstellung: löscht data/ (WLAN, Server, Admin-Passwort, Cache, Slideshow-Bilder,
# Demo-Modus, Update-Status), die WLAN-Verbindungen des Rahmens in NetworkManager und das Kiosk-Profil.
# Danach startet der Daemon in der Einrichtung (Hotspot). Code und Pi OS bleiben, wie sie sind.
#   ./scripts/factory-reset.sh        fragt nach
#   ./scripts/factory-reset.sh -y     ohne Nachfrage
# Ein WLAN, das im Pi Imager eingetragen wurde, bleibt in Pi OS; im Hotspot ist es ohnehin getrennt.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$DIR/data"
HAS_SYSTEMD=0
command -v systemctl >/dev/null && systemctl list-unit-files trainingsrahmen.service >/dev/null 2>&1 && HAS_SYSTEMD=1

if [ "${1:-}" != "-y" ]; then
  echo "Werkseinstellung: Alles unter $DATA wird gelöscht (Einstellungen, Passwort, Bilder),"
  echo "dazu die WLAN-Verbindungen des Rahmens. Danach öffnet der Pi den Hotspot; SSH über WLAN bricht ab."
  read -r -p "Wirklich zurücksetzen? Tippe „ja“: " answer
  [ "$answer" = "ja" ] || { echo "Abgebrochen."; exit 1; }
fi

if [ "$HAS_SYSTEMD" -eq 1 ]; then
  systemctl stop trainingsrahmen.service || sudo systemctl stop trainingsrahmen.service
fi

rm -rf "${DATA:?}"
mkdir -p "$DATA"
echo "data/ gelöscht."

if command -v nmcli >/dev/null; then
  for con in rahmen-wifi rahmen-hotspot; do
    nmcli connection delete "$con" >/dev/null 2>&1 && echo "WLAN-Verbindung $con gelöscht." || true
  done
fi
rm -rf "$HOME/.cache/trainingsrahmen-chromium"

if [ "$HAS_SYSTEMD" -eq 1 ]; then
  systemctl start trainingsrahmen.service || sudo systemctl start trainingsrahmen.service
  systemctl restart trainingsrahmen-kiosk.service || sudo systemctl restart trainingsrahmen-kiosk.service
  echo "Zurückgesetzt, der Rahmen startet in der Einrichtung."
else
  echo "Zurückgesetzt. Kein systemd-Dienst gefunden – Daemon von Hand neu starten (npm run dev / npm start)."
fi
