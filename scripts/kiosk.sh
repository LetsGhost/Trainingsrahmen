#!/usr/bin/env bash
# Startet das Display im Chromium-Kiosk unter cage (Pi OS Lite ohne Desktop). Läuft über
# trainingsrahmen-kiosk.service als Login-Session auf tty1; der Daemon ist ein eigener Dienst.
# Übernommen von der Slotmaschine (start.sh), mit allem, was dort nach Stromausfällen und Kaltstarts nötig war.
#
# Schalter (in data/frame.env oder per „sudo systemctl set-environment …“):
#   FRAME_ROTATION=normal|90|180|270   Bild drehen (wlr-randr); Touch dreht damit nicht mit, siehe ENTWICKLUNG.md
#   FRAME_HIDE_CURSOR=0                Mauszeiger sichtbar lassen
#   FRAME_CHROMIUM_FLAGS="…"           zusätzliche Chromium-Flags, z. B. --disable-gpu
#   FRAME_CAGE_DEBUG=1                 ausführliches cage-Log

set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "Bitte nicht als root starten (cage/Chromium brauchen eine normale User-Session)." >&2
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8080}"
URL="http://localhost:$PORT/display"
HEALTH="http://localhost:$PORT/health"
ROTATION="${FRAME_ROTATION:-normal}"
# So lange darf es dauern, bis das Display an /events hängt; danach so lange ohne Display, bis neu gestartet wird.
READY_TIMEOUT_SEC="${FRAME_READY_TIMEOUT_SEC:-90}"
LOST_TIMEOUT_SEC="${FRAME_LOST_TIMEOUT_SEC:-60}"
DAEMON_WAIT_SEC=60
DISPLAY_WAIT_SEC=30

# Absturzschleifen bremsen: Endet ein Start, bevor das Display sichtbar war, wartet der nächste länger
# (5 s, 10 s, … höchstens 60 s). Sonst läuft das Journal voll, ohne dass man den Fehler sieht.
FAIL_FILE="/tmp/trainingsrahmen-kiosk-failed-starts"
failed_starts="$(cat "$FAIL_FILE" 2>/dev/null || echo 0)"
case "$failed_starts" in ''|*[!0-9]*) failed_starts=0 ;; esac
if [ "$failed_starts" -gt 0 ]; then
  delay=$((failed_starts * 5))
  [ "$delay" -gt 60 ] && delay=60
  echo "Letzte $failed_starts Start(s) fehlgeschlagen – warte ${delay} s."
  sleep "$delay"
fi

# Mauszeiger ausblenden: Den Zeiger zeichnet cage, nicht Chromium – CSS „cursor: none“ greift bei reinem
# Touch nie. Daher ein unsichtbares Cursor-Theme unter allen Namen, die geladen werden.
CURSOR_ICONS_DIR="$HOME/.local/share/icons"
CURSOR_THEMES=(frame-invisible default Adwaita)
if [ "${FRAME_HIDE_CURSOR:-1}" = "1" ]; then
  for theme in "${CURSOR_THEMES[@]}"; do
    grep -qs "Name=frame-invisible" "$CURSOR_ICONS_DIR/$theme/index.theme" || node "$DIR/scripts/invisible-cursor.js" "$CURSOR_ICONS_DIR/$theme"
  done
  export XCURSOR_THEME=frame-invisible XCURSOR_SIZE=24
  export XCURSOR_PATH="$CURSOR_ICONS_DIR:$HOME/.icons:/usr/share/icons:/usr/share/pixmaps"
  # Manche Pi-Grafiktreiber zeigen über den Hardware-Cursor sonst trotzdem einen Zeiger.
  export WLR_NO_HARDWARE_CURSORS=1
else
  for theme in "${CURSOR_THEMES[@]}"; do
    grep -qs "Name=frame-invisible" "$CURSOR_ICONS_DIR/$theme/index.theme" && rm -rf "${CURSOR_ICONS_DIR:?}/$theme"
  done
fi

# Reste eines vorherigen Laufs beenden: Ein altes Chromium nimmt die URL an und das neue beendet sich sofort.
pkill -u "$(id -u)" -x cage 2>/dev/null || true
pkill -u "$(id -u)" -f -- "--kiosk.*localhost:$PORT" 2>/dev/null || true

BROWSER_PID=""
ready=0
stopping=0
cleanup() {
  [ -n "$BROWSER_PID" ] && kill "$BROWSER_PID" 2>/dev/null || true
  # Gewolltes Stoppen (systemctl stop/restart) zählt nicht als Fehlstart.
  if [ "$ready" -eq 0 ] && [ "$stopping" -eq 0 ]; then
    echo $((failed_starts + 1)) > "$FAIL_FILE" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'stopping=1; exit 143' TERM INT

echo "Warte auf den Daemon unter $HEALTH …"
waited=0
until curl -fs -o /dev/null "$HEALTH"; do
  if [ "$waited" -ge $((DAEMON_WAIT_SEC * 5)) ]; then
    echo "Daemon antwortet nach ${DAEMON_WAIT_SEC} s nicht (journalctl -u trainingsrahmen)." >&2
    exit 1
  fi
  sleep 0.2
  waited=$((waited + 1))
done

BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then
  echo "Chromium fehlt: sudo apt install chromium" >&2
  exit 1
fi

# Eigenes Profil nur für den Kiosk. Ein Stromausfall kann Dateien wie „Local State“ halb geschrieben
# zurücklassen; Chromium stürzt dann beim Start ab (Exit 139), ohne etwas zu loggen. Das Profil enthält
# nichts Wichtiges (--incognito), daher nach wiederholten Abstürzen neu anlegen.
PROFILE_DIR="$HOME/.cache/trainingsrahmen-chromium"
if [ "$failed_starts" -ge 2 ] && [ -d "$PROFILE_DIR" ]; then
  echo "Chromium ist ${failed_starts}x abgestürzt – setze das Kiosk-Profil zurück." >&2
  rm -rf "$PROFILE_DIR"
fi
# Nach Stromausfall bleiben Sperrdateien liegen; bekommt ein anderer Prozess dieselbe PID, startet Chromium nicht.
rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonSocket" "$PROFILE_DIR/SingletonCookie"

BROWSER_FLAGS=(
  --kiosk
  --noerrdialogs
  --disable-infobars
  --disable-session-crashed-bubble
  --no-first-run
  --password-store=basic
  --incognito
  --disable-features=Translate
  --lang=de
  # Touch: kein Zoomen mit zwei Fingern, kein Zurück per Wischen
  --disable-pinch
  --overscroll-history-navigation=0
  --check-for-update-interval=31536000
  # DevTools nur auf localhost; vom PC per SSH-Tunnel: ssh -L 9222:localhost:9222 <pi>, dann chrome://inspect
  --remote-debugging-port=9222
  --user-data-dir="$PROFILE_DIR"
  --enable-logging=stderr
  --log-level=2
)
if [ -n "${FRAME_CHROMIUM_FLAGS:-}" ]; then
  read -r -a extra_flags <<< "$FRAME_CHROMIUM_FLAGS"
  BROWSER_FLAGS+=("${extra_flags[@]}")
  echo "Zusätzliche Chromium-Flags: $FRAME_CHROMIUM_FLAGS"
fi

if [ -n "${WAYLAND_DISPLAY:-}" ] || [ -n "${DISPLAY:-}" ]; then
  # Es läuft schon eine grafische Oberfläche (Desktop-Image)
  "$BROWSER" "${BROWSER_FLAGS[@]}" "$URL" &
  BROWSER_PID=$!
else
  if [ -n "${SSH_CONNECTION:-}" ]; then
    echo "Per SSH kann cage den Bildschirm nicht übernehmen. Stattdessen: sudo systemctl restart trainingsrahmen-kiosk" >&2
    exit 1
  fi
  command -v cage >/dev/null || { echo "cage fehlt: sudo apt install cage" >&2; exit 1; }
  # Nach einem Kaltstart ist das Display manchmal noch nicht bereit, wenn cage startet – dann bleibt es weiß.
  for _ in $(seq 1 "$DISPLAY_WAIT_SEC"); do
    grep -qx connected /sys/class/drm/card*-*/status 2>/dev/null && break
    sleep 1
  done
  CAGE_FLAGS=()
  [ "${FRAME_CAGE_DEBUG:-0}" = "1" ] && CAGE_FLAGS+=(-d)
  # Innerhalb von cage erst alle Ausgaben drehen, dann Chromium starten.
  cage "${CAGE_FLAGS[@]}" -- bash -c '
    rotation="$1"; shift
    if [ "$rotation" != "normal" ] && command -v wlr-randr >/dev/null 2>&1; then
      for output in $(wlr-randr | grep -E "^[^ ]" | cut -d" " -f1); do
        wlr-randr --output "$output" --transform "$rotation"
      done
    fi
    echo "cage läuft – starte $1 …"
    exec "$@"
  ' _ "$ROTATION" "$BROWSER" "${BROWSER_FLAGS[@]}" --ozone-platform=wayland "$URL" &
  BROWSER_PID=$!
fi

# Überwachung: Browser zu → Ende (systemd startet neu). Hängt das Display nicht binnen READY_TIMEOUT_SEC an
# /events (weißer Bildschirm, Absturz der Seite) oder ist es danach LOST_TIMEOUT_SEC weg → Ende mit Fehler.
# Antwortet der Daemon gar nicht (Neustart beim Update), wird nur gewartet.
started=$SECONDS
lost_since=""
while true; do
  if ! kill -0 "$BROWSER_PID" 2>/dev/null; then
    status=0
    wait "$BROWSER_PID" || status=$?
    echo "Browser/cage nach $((SECONDS - started)) s beendet (Exit $status) – Neustart." >&2
    # Auch Exit 0 ist ein Fehler: Im Kiosk soll der Browser nie zugehen.
    exit "$([ "$status" -eq 0 ] && echo 1 || echo "$status")"
  fi
  health="$(curl -fs --max-time 2 "$HEALTH" || true)"
  if [ -n "$health" ]; then
    if [[ "$health" == *'"display":true'* ]]; then
      lost_since=""
      if [ "$ready" -eq 0 ]; then
        ready=1
        rm -f "$FAIL_FILE"
        echo "Display nach $((SECONDS - started)) s sichtbar."
      fi
    elif [ "$ready" -eq 0 ] && [ $((SECONDS - started)) -ge "$READY_TIMEOUT_SEC" ]; then
      echo "Display nach ${READY_TIMEOUT_SEC} s nicht da (weißer Bildschirm?) – Neustart." >&2
      exit 1
    elif [ "$ready" -eq 1 ]; then
      lost_since="${lost_since:-$SECONDS}"
      if [ $((SECONDS - lost_since)) -ge "$LOST_TIMEOUT_SEC" ]; then
        echo "Display seit ${LOST_TIMEOUT_SEC} s nicht mehr verbunden – Neustart." >&2
        exit 1
      fi
    fi
  fi
  sleep 2
done
