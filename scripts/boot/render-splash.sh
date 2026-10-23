#!/usr/bin/env bash
# Rendert scripts/boot/splash.png neu aus splash.html (z. B. nach Änderung der Versionsnummer).
# Braucht Chromium (am Pi vorhanden) oder Chrome; danach ./scripts/setup-bootscreen.sh erneut ausführen.
set -euo pipefail

BOOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
[ -n "$BROWSER" ] || { echo "Chromium fehlt." >&2; exit 1; }

"$BROWSER" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --user-data-dir="$(mktemp -d)" --window-size=800,480 \
  --screenshot="$BOOT/splash.png" "file://$BOOT/splash.html"
echo "Neu gerendert: $BOOT/splash.png"
