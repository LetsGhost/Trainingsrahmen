#!/usr/bin/env bash
# Rendert scripts/boot/splash-1..3.png (1 bis 3 Punkte aktiv) neu aus splash.html.
# Braucht Chromium (am Pi vorhanden) oder Chrome; danach ./scripts/setup-bootscreen.sh erneut ausführen.
set -euo pipefail

BOOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
[ -n "$BROWSER" ] || { echo "Chromium fehlt." >&2; exit 1; }

for n in 1 2 3; do
  "$BROWSER" --headless=new --disable-gpu --disable-lcd-text --hide-scrollbars --force-device-scale-factor=1 \
    --user-data-dir="$(mktemp -d)" --window-size=800,480 --virtual-time-budget=2000 \
    --screenshot="$BOOT/splash-$n.png" "file://$BOOT/splash.html#$n"
  echo "Neu gerendert: $BOOT/splash-$n.png"
done
