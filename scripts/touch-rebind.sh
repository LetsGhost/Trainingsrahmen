#!/usr/bin/env bash
# Bindet den Touch-Treiber des DSI-Displays neu, falls er beim Booten fehlgeschlagen ist. Übernommen von der
# Slotmaschine: Der Touch-Chip ist beim ersten Versuch oft noch nicht bereit („I2C communication failure: -5“),
# dann gibt es kein Touch-Gerät, obwohl das Bild läuft. Ein erneutes Binden klappt danach zuverlässig.
# Je nach Waveshare-Version sitzt ein Goodix- (0x5d/0x14) oder ein FT5x06-Chip (0x38) dahinter; beide werden probiert.
# Läuft als root über trainingsrahmen-touch.service. Logs: journalctl -u trainingsrahmen-touch
# Von Hand: echo 10-005d | sudo tee /sys/bus/i2c/drivers/Goodix-TS/bind

ATTEMPTS=15
# I2C-Adresse → Treiber-Ordner unter /sys/bus/i2c/drivers
declare -A DRIVERS=([005d]=Goodix-TS [0014]=Goodix-TS [0038]=edt_ft5x06)

for i in $(seq 1 "$ATTEMPTS"); do
  found=0
  for addr in "${!DRIVERS[@]}"; do
    for dev in /sys/bus/i2c/devices/*-"$addr"; do
      [ -e "$dev" ] || continue
      found=1
      name="$(basename "$dev")"
      if [ -e "$dev/driver" ]; then
        echo "Touch $name gebunden (Versuch $i)."
        exit 0
      fi
      bind="/sys/bus/i2c/drivers/${DRIVERS[$addr]}/bind"
      if [ -e "$bind" ]; then
        echo "Touch $name nicht gebunden – binde neu an ${DRIVERS[$addr]} (Versuch $i/$ATTEMPTS) …"
        echo "$name" > "$bind" 2>/dev/null || true
      fi
    done
  done
  # Ohne I2C-Gerät für den Touch (z. B. Overlay fehlt) gibt es nichts zu binden.
  if [ "$found" -eq 0 ] && [ "$i" -ge 5 ]; then
    echo "Kein Touch-Chip am I2C gefunden (dtoverlay in config.txt prüfen)." >&2
    exit 1
  fi
  sleep 2
done

echo "Touch-Treiber konnte nicht gebunden werden." >&2
exit 1
