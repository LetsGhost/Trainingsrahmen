#!/usr/bin/env bash
# Installiert die systemd-Units (Daemon, Kiosk, Update, Touch-Fix, Hotspot), die polkit-Regel und die
# Backlight-Regel und startet Daemon und Kiosk neu. Kann gefahrlos mehrfach laufen; nach jeder Änderung an
# scripts/systemd/ oder scripts/system/ ausführen (deploy.sh macht das selbst).
#   ./scripts/install-services.sh             installieren und neu starten
#   ./scripts/install-services.sh --no-start  nur installieren und aktivieren (setup-pi.sh, danach reboot)
# User und Pfad kommen von dem, der das Skript startet: User = du, Pfad = dieses Repo.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(id -un)"
NODE="$(command -v node || true)"
START=1
[ "${1:-}" = "--no-start" ] && START=0

if [ "$(id -u)" -eq 0 ]; then
  echo "Bitte als normaler User ohne sudo starten – das Skript fragt selbst nach sudo." >&2
  exit 1
fi
if [ -z "$NODE" ]; then
  echo "node fehlt – erst scripts/setup-pi.sh ausführen." >&2
  exit 1
fi

# @USER@, @DIR@ und @NODE@ in den Vorlagen ersetzen und installieren.
render() {
  sed -e "s|@USER@|$APP_USER|g" -e "s|@DIR@|$DIR|g" -e "s|@NODE@|$NODE|g" "$1" | sudo tee "$2" >/dev/null
  sudo chmod "$3" "$2"
}

chmod +x "$DIR"/scripts/*.sh

for unit in trainingsrahmen.service trainingsrahmen-kiosk.service trainingsrahmen-update.service trainingsrahmen-touch.service trainingsrahmen-hotspot.service; do
  render "$DIR/scripts/systemd/$unit" "/etc/systemd/system/$unit" 0644
done
sudo mkdir -p /etc/polkit-1/rules.d
render "$DIR/scripts/system/trainingsrahmen.rules" /etc/polkit-1/rules.d/50-trainingsrahmen.rules 0644
# Captive-DNS der früheren NetworkManager-Hotspots; das macht jetzt die Hotspot-Unit.
sudo rm -f /etc/NetworkManager/dnsmasq-shared.d/trainingsrahmen.conf
sudo install -m 0644 "$DIR/scripts/system/99-trainingsrahmen-backlight.rules" /etc/udev/rules.d/99-trainingsrahmen-backlight.rules
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=backlight --action=add || true

sudo systemctl daemon-reload
# Autostart beim Booten (macht nichts, wenn schon aktiviert). Die Update-Unit startet nur per Knopf.
sudo systemctl enable trainingsrahmen.service trainingsrahmen-kiosk.service trainingsrahmen-touch.service

if [ "$START" -eq 0 ]; then
  echo "Installiert. Startet beim nächsten Booten."
  exit 0
fi

# Ohne Einrichtung öffnet der Daemon den Hotspot – das Heim-WLAN (und SSH darüber) ist dann weg.
if [ ! -f "$DIR/data/config.json" ] && ! grep -qs '^FRAME_DEMO=1' "$DIR/data/frame.env"; then
  echo "Hinweis: Noch nicht eingerichtet. Der Pi öffnet gleich den Hotspot, eine SSH-Verbindung über WLAN bricht ab." >&2
  echo "         Einrichten per Handy (QR-Code am Display) oder vorher ./scripts/demo.sh on." >&2
fi
# Touch-Fix gleich einmal laufen lassen, falls der Touch gerade fehlt.
sudo systemctl start trainingsrahmen-touch.service || true
sudo systemctl restart trainingsrahmen.service
sudo systemctl restart trainingsrahmen-kiosk.service
echo "Neu gestartet. Logs: journalctl -u trainingsrahmen -f   bzw.   journalctl -t trainingsrahmen-kiosk -f"
