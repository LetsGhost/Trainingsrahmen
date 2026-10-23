#!/usr/bin/env bash
# Richtet den Boot-Bildschirm ein: Plymouth-Theme „trainingsrahmen“ (Splash 4A, dunkel, mit laufendem Balken)
# statt Regenbogen und Kernel-Text. Das Bild bleibt stehen, bis der Kiosk das Display übernimmt.
# Ruft scripts/setup-pi.sh auf; kann auch allein und gefahrlos mehrfach laufen. Gilt nach dem Neustart.
#
#   ./scripts/setup-bootscreen.sh
#
# Bild ändern: scripts/boot/splash.html anpassen, ./scripts/boot/render-splash.sh, dann dieses Skript.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
THEME=trainingsrahmen
THEME_DIR="/usr/share/plymouth/themes/$THEME"

step() { echo; echo "==> $*"; }

if [ "$(id -u)" -eq 0 ]; then
  echo "Bitte als normaler User (z. B. admin) ohne sudo starten – das Skript fragt selbst nach sudo." >&2
  exit 1
fi

step "Plymouth installieren"
sudo apt-get install -y plymouth

step "Theme $THEME installieren"
sudo mkdir -p "$THEME_DIR"
sudo install -m 0644 \
  "$DIR/scripts/boot/$THEME.plymouth" \
  "$DIR/scripts/boot/$THEME.script" \
  "$DIR/scripts/boot/splash.png" \
  "$DIR/scripts/boot/bar.png" \
  "$THEME_DIR/"

step "Firmware: kein Regenbogen, Initramfs an (config.txt)"
CONFIG=/boot/firmware/config.txt
[ -f "$CONFIG" ] || CONFIG=/boot/config.txt
[ -f "$CONFIG.orig" ] || sudo cp "$CONFIG" "$CONFIG.orig"
# Ohne Initramfs startet Plymouth erst spät aus dem Root-Dateisystem; Pi OS Bookworm hat auto_initramfs=1 schon.
missing=()
for line in disable_splash=1 auto_initramfs=1; do
  if grep -qE "^${line%%=*}=" "$CONFIG"; then
    echo "Bleibt: $(grep -E "^${line%%=*}=" "$CONFIG" | tail -1)"
  else
    missing+=("$line")
  fi
done
if [ ${#missing[@]} -gt 0 ]; then
  # Unter [all], damit ein [pi4]- oder [cm4]-Abschnitt davor es nicht auf andere Modelle beschränkt.
  { printf '\n[all]\n# Trainingsrahmen: Boot-Bildschirm\n'; printf '%s\n' "${missing[@]}"; } | sudo tee -a "$CONFIG" >/dev/null
  echo "Eingetragen: ${missing[*]}"
fi

step "Kernel: Splash an, Meldungen aus (cmdline.txt)"
CMDLINE=/boot/firmware/cmdline.txt
[ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
[ -f "$CMDLINE.orig" ] || sudo cp "$CMDLINE" "$CMDLINE.orig"
sudo sed -i 's/\bconsole=tty1\b/console=tty3/' "$CMDLINE"
for param in quiet splash plymouth.ignore-serial-consoles loglevel=3 logo.nologo vt.global_cursor_default=0; do
  if ! grep -qE "(^| )$param( |$)" "$CMDLINE"; then
    # cmdline.txt muss eine einzige Zeile bleiben
    sudo sed -i "1 s/\$/ $param/" "$CMDLINE"
  fi
done
cat "$CMDLINE"

step "Bild bis zum Kiosk stehen lassen"
# plymouth-quit räumt den Bildschirm sonst schwarz, bis cage startet (der Kiosk wartet auf den Daemon).
sudo mkdir -p /etc/systemd/system/plymouth-quit.service.d
printf '[Service]\nExecStart=\nExecStart=-/usr/bin/plymouth quit --retain-splash\n' \
  | sudo tee /etc/systemd/system/plymouth-quit.service.d/retain-splash.conf >/dev/null
sudo systemctl daemon-reload

step "Theme setzen und Initramfs neu bauen (dauert auf dem Pi 3 ein paar Minuten)"
# Grafiktreiber ins Initramfs, damit der Splash schon früh auf dem DSI-Display erscheint.
echo "FRAMEBUFFER=y" | sudo tee /etc/initramfs-tools/conf.d/splash >/dev/null
sudo plymouth-set-default-theme -R "$THEME"
echo "Aktives Theme: $(plymouth-set-default-theme)"

echo
echo "Fertig. Gilt nach dem Neustart: sudo reboot"
