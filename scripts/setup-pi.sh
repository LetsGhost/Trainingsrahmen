#!/usr/bin/env bash
# Richtet den Trainingsrahmen auf einem frisch geflashten Raspberry Pi OS Lite (64-bit, Bookworm oder neuer)
# komplett ein: Pakete, Node, WLAN-Land, Display (Waveshare 7" DSI), Rechte, ruhiger Boot, Dienste. Kann gefahrlos mehrfach laufen.
# Aufgebaut wie deploy/setup-pi.sh der Slotmaschine.
#
# Ablauf auf der neuen SD-Karte (im Pi Imager User „admin“ und Hostname „rahmen“ anlegen, SSH an):
#   sudo apt install -y git
#   git clone https://github.com/LetsGhost/Trainingsrahmen.git ~/trainingsrahmen
#   cd ~/trainingsrahmen && ./scripts/setup-pi.sh
#   ./scripts/demo.sh on      # optional: erst ohne Einrichtung vorführen
#   sudo reboot
# Nach dem Neustart öffnet der Pi ohne Einrichtung den Hotspot „Rahmen-XXXX“ (QR-Code am Display).
# Das Heim-WLAN aus dem Pi Imager ist dann weg, bis die Einrichtung am Handy durch ist.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(id -un)"
NODE_MIN=18
WIFI_COUNTRY="${FRAME_WIFI_COUNTRY:-DE}"
# Overlay für das Waveshare 7" DSI (800 × 480); „none“ lässt config.txt in Ruhe.
DSI_OVERLAY="${FRAME_DSI_OVERLAY:-vc4-kms-dsi-7inch}"

step() { echo; echo "==> $*"; }

if [ "$(id -u)" -eq 0 ]; then
  echo "Bitte als normaler User (z. B. admin) ohne sudo starten – das Skript fragt selbst nach sudo." >&2
  exit 1
fi
if [ "$APP_USER" != "admin" ] || [ "$DIR" != "/home/admin/trainingsrahmen" ]; then
  echo "Hinweis: Gedacht ist User „admin“ mit Repo unter /home/admin/trainingsrahmen." >&2
  echo "         Gefunden: User „$APP_USER“, Repo unter $DIR. Die Dienste werden dafür eingerichtet." >&2
fi

step "Pakete installieren"
sudo apt-get update
sudo apt-get install -y \
  git curl \
  nodejs \
  cage chromium wlr-randr \
  network-manager dnsmasq-base hostapd \
  gpiod i2c-tools libinput-tools \
  avahi-daemon \
  fonts-dejavu-core

step "Node prüfen (mindestens $NODE_MIN)"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt "$NODE_MIN" ]; then
  echo "Node $(node -v) ist zu alt, gebraucht wird $NODE_MIN oder neuer." >&2
  exit 1
fi
echo "Node $(node -v)"

step "WLAN: NetworkManager und Land ($WIFI_COUNTRY)"
if ! systemctl is-active --quiet NetworkManager; then
  echo "NetworkManager läuft nicht. Ab Pi OS Bookworm ist er Standard – älteres Image?" >&2
  exit 1
fi
# Ohne gesetztes Land bleibt das WLAN auf Pi OS per rfkill gesperrt, dann gibt es keinen Hotspot.
if [ -z "$(sudo raspi-config nonint get_wifi_country 2>/dev/null || true)" ]; then
  sudo raspi-config nonint do_wifi_country "$WIFI_COUNTRY"
fi
sudo rfkill unblock wifi || true

step "Display (DSI) und I2C für den Touch"
CONFIG=/boot/firmware/config.txt
[ -f "$CONFIG" ] || CONFIG=/boot/config.txt
[ -f "$CONFIG.orig" ] || sudo cp "$CONFIG" "$CONFIG.orig"
sudo raspi-config nonint do_i2c 0
if [ "$DSI_OVERLAY" = "none" ]; then
  echo "config.txt bleibt unverändert (FRAME_DSI_OVERLAY=none)."
elif grep -qE '^dtoverlay=vc4-kms-dsi-' "$CONFIG"; then
  echo "DSI-Overlay ist schon eingetragen: $(grep -E '^dtoverlay=vc4-kms-dsi-' "$CONFIG")"
else
  # Unter [all] anhängen, damit ein [pi4]- oder [cm4]-Abschnitt davor es nicht auf andere Modelle beschränkt.
  printf '\n[all]\n# Trainingsrahmen: Waveshare 7" DSI, 800 x 480\ndtoverlay=%s\n' "$DSI_OVERLAY" | sudo tee -a "$CONFIG" >/dev/null
  echo "dtoverlay=$DSI_OVERLAY eingetragen (gilt nach dem Neustart)."
fi

step "Hostname"
if [ "$(hostname)" = "raspberrypi" ]; then
  sudo raspi-config nonint do_hostname rahmen
  echo "Hostname auf „rahmen“ gesetzt (gilt nach dem Neustart, erreichbar als rahmen.local)."
else
  echo "Bleibt „$(hostname)“ (erreichbar als $(hostname).local)."
fi

step "Gruppen für GPIO, Display, Touch, Netzwerk"
for group in gpio i2c video render input netdev; do
  if getent group "$group" >/dev/null; then
    sudo usermod -aG "$group" "$APP_USER"
  fi
done

step "Ruhiger Boot (cmdline.txt)"
CMDLINE=/boot/firmware/cmdline.txt
[ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
[ -f "$CMDLINE.orig" ] || sudo cp "$CMDLINE" "$CMDLINE.orig"
# Kernel-Meldungen von tty1 weg, damit der Kiosk dort sauber startet
sudo sed -i 's/\bconsole=tty1\b/console=tty3/' "$CMDLINE"
for param in quiet loglevel=3 logo.nologo vt.global_cursor_default=0; do
  if ! grep -qE "(^| )$param( |$)" "$CMDLINE"; then
    # cmdline.txt muss eine einzige Zeile bleiben
    sudo sed -i "1 s/\$/ $param/" "$CMDLINE"
  fi
done

step "Daten-Ordner"
mkdir -p "$DIR/data"

step "Dienste installieren"
"$DIR/scripts/install-services.sh" --no-start

step "Selbsttest"
for f in "$DIR"/daemon/*.js "$DIR"/daemon/system/*.js; do
  node --check "$f"
done
echo "Daemon-Code lässt sich laden."
if chromium --headless=new --disable-gpu --user-data-dir="$(mktemp -d)" --dump-dom about:blank >/dev/null 2>&1; then
  echo "Chromium startet."
else
  echo "WARNUNG: Chromium startet nicht – SD-Karte/Installation prüfen." >&2
fi
command -v gpiomon >/dev/null && echo "gpiomon da ($(gpiomon --version | head -1))." || echo "WARNUNG: gpiomon fehlt, PIR geht nicht." >&2
broken="$(sudo dpkg --verify 2>/dev/null | grep -v ' c /' || true)"
if [ -n "$broken" ]; then
  echo "WARNUNG: Beschädigte Paketdateien:" >&2
  echo "$broken" >&2
else
  echo "Alle Paketdateien in Ordnung."
fi

echo
echo "Fertig. Optional erst vorführen: ./scripts/demo.sh on"
echo "Dann neu starten: sudo reboot"
echo "Logs: journalctl -u trainingsrahmen -f   und   journalctl -t trainingsrahmen-kiosk -f"
