#!/usr/bin/env bash
# Systemtest auf dem Pi: misst und prüft, was sich ohne Hand und Auge prüfen lässt (TESTPLAN-PI.md).
# Touch, Bewegungssensor, Helligkeit und das Portal auf dem Handy bleiben Handarbeit.
#   ./scripts/pi-check.sh            Momentaufnahme: Bootzeit, RAM, Temperatur, Dienste, Fehler im Log
#   ./scripts/pi-check.sh soak [h]   Dauerlauf: alle 5 min eine Zeile nach data/soak.csv, Standard 48 h
#   ./scripts/pi-check.sh remote     vom PC aus: prüft, dass /api/frame/* von außen gesperrt ist
#                                    (FRAME_PI=rahmen.local, Standard)
set -uo pipefail

BASE="http://localhost:8080"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
FAILS=0

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
bad()  { printf '  \033[31mFEHLER\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }
info() { printf '  ·     %s\n' "$*"; }
head_() { printf '\n== %s\n' "$*"; }

mem_used() { free -m | awk '/^Mem:/ {print $3}'; }
swap_used() { free -m | awk '/^Swap:/ {print $3}'; }
temp() { awk '{printf "%.1f", $1 / 1000}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null; }
# Speicher des Kiosk-Browsers (alle Prozesse zusammen) in MB.
browser_mem() { ps -eo rss,comm | awk '/chrom|cog|WPE/ {s += $1} END {printf "%d", s / 1024}'; }

if [ "${1:-}" = "remote" ]; then
  HOST="${FRAME_PI:-rahmen.local}"
  head_ "Zugriff von außen auf $HOST"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "http://$HOST:8080/api/frame/sync")
  [ "$code" = "403" ] && ok "/api/frame/sync von außen gesperrt ($code)" || bad "/api/frame/sync von außen antwortet $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://$HOST:8080/health")
  [ "$code" = "200" ] && ok "/health erreichbar" || bad "/health antwortet $code"
  exit $((FAILS > 0))
fi

if [ "${1:-}" = "soak" ]; then
  HOURS="${2:-48}"
  OUT="$DIR/data/soak.csv"
  [ -f "$OUT" ] || echo "zeit,ram_mb,swap_mb,browser_mb,temp_c,drossel,display,sync_fehler" > "$OUT"
  echo "Dauerlauf $HOURS h → $OUT (Abbruch mit Strg+C; tipp: in tmux oder mit nohup starten)"
  end=$(( $(date +%s) + HOURS * 3600 ))
  while [ "$(date +%s)" -lt "$end" ]; do
    health=$(curl -s -m 5 "$BASE/health")
    display=$(echo "$health" | grep -q '"display":true' && echo ja || echo nein)
    errors=$(journalctl -u trainingsrahmen --since "-5 min" -q 2>/dev/null | grep -ciE "error|fehler")
    echo "$(date '+%F %T'),$(mem_used),$(swap_used),$(browser_mem),$(temp),$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2),$display,$errors" >> "$OUT"
    sleep 300
  done
  echo "Fertig. Auswerten: RAM-Spalte sollte nicht stetig steigen, display immer ja, drossel 0x0."
  exit 0
fi

head_ "Boot"
info "$(systemd-analyze 2>/dev/null | head -1)"
line=$(journalctl -b -u trainingsrahmen -q -g "Display verbunden" 2>/dev/null | head -1)
if [ -n "$line" ]; then ok "Einschalten bis Plan: ${line##*nach }"; else bad "Display hat sich in diesem Boot nicht verbunden"; fi
info "Läuft seit: $(uptime -p)"

head_ "Ressourcen"
info "RAM belegt: $(mem_used) MB von $(free -m | awk '/^Mem:/ {print $2}') MB, Swap: $(swap_used) MB"
info "Browser: $(browser_mem) MB"
t=$(temp)
info "CPU-Temperatur: $t °C"
throttled=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
# Bit 0/16: Unterspannung jetzt/seit Boot – meist ein zu schwaches Netzteil.
if [ -z "$throttled" ]; then info "vcgencmd fehlt, Drosselung nicht geprüft"
elif [ "$throttled" = "0x0" ]; then ok "Keine Unterspannung oder Drosselung seit Boot"
else bad "get_throttled=$throttled (Netzteil oder Kühlung prüfen)"; fi
info "Daten-Partition: $(df -h "$DIR" | awk 'NR==2 {print $4 " frei"}')"

head_ "Dienste"
for unit in trainingsrahmen trainingsrahmen-kiosk; do
  systemctl is-active -q "$unit" && ok "$unit läuft" || bad "$unit läuft nicht"
  n=$(systemctl show "$unit" -p NRestarts --value)
  [ "${n:-0}" = "0" ] && ok "$unit ohne Neustarts" || bad "$unit wurde $n-mal neu gestartet"
done
[ "$(systemctl show trainingsrahmen-hotspot -p Restart --value)" = "on-failure" ] \
  && ok "Hotspot-Unit mit Restart=on-failure" || bad "Hotspot-Unit ohne Restart=on-failure (install-services.sh ausführen)"

head_ "Daemon"
health=$(curl -s -m 5 "$BASE/health")
if [ -z "$health" ]; then bad "/health antwortet nicht"
else
  commit=$(git -C "$DIR" rev-parse HEAD)
  echo "$health" | grep -q "\"commit\":\"$commit\"" && ok "läuft auf Commit ${commit:0:7}" || bad "/health meldet anderen Commit als HEAD"
  echo "$health" | grep -q '"display":true' && ok "Display verbunden" || bad "Display nicht verbunden"
fi
[ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ] && ok "keine lokalen Änderungen (Update-Knopf geht)" \
  || info "lokale Änderungen vorhanden (deploy.sh); Update-Knopf bricht ab"

head_ "Hardware"
bl=$(ls -d /sys/class/backlight/* 2>/dev/null | head -1)
if [ -n "$bl" ]; then
  ok "Backlight $(basename "$bl"): brightness $(cat "$bl/brightness") von $(cat "$bl/max_brightness")"
  [ "$(cat "$bl/max_brightness")" -le 1 ] && bad "max_brightness ≤ 1: nur an/aus, keine Helligkeitsstufen"
else bad "kein Backlight unter /sys/class/backlight"; fi
pgrep -x gpiomon >/dev/null && ok "PIR: gpiomon läuft" || info "PIR: gpiomon läuft nicht (FRAME_PIR_PIN=off?)"

head_ "Netz"
ssid=$(nmcli -t -f active,ssid dev wifi 2>/dev/null | awk -F: '$1 == "yes" {print $2}')
[ -n "$ssid" ] && ok "WLAN: $ssid" || info "kein WLAN verbunden"
info "WLAN-Stromsparen: $(iw dev wlan0 get power_save 2>/dev/null || echo unbekannt)"
churn=$(journalctl -b -u NetworkManager -q 2>/dev/null | grep -cE "connection-(add|delete).*rahmen-wifi")
[ "$churn" -le 2 ] && ok "rahmen-wifi in diesem Boot $churn-mal angelegt/gelöscht" \
  || bad "rahmen-wifi in diesem Boot $churn-mal angelegt/gelöscht (Neuanlage-Schleife?)"

head_ "Log seit Boot"
# journald stuft stdout und stderr von Node gleich ein (info), daher nach Wörtern statt nach Priorität.
ERR_RE="error|fehler|nicht verfügbar|unhandled|EADDRINUSE"
warn=$(journalctl -b -u trainingsrahmen -q 2>/dev/null | grep -ciE "$ERR_RE")
[ "$warn" = "0" ] && ok "keine Fehlermeldungen" || { bad "$warn Fehlermeldungen, die letzten:"; journalctl -b -u trainingsrahmen -q --no-pager | grep -iE "$ERR_RE" | tail -5 | sed 's/^/        /'; }

printf '\n%s\n' "$([ $FAILS = 0 ] && echo "Alles OK." || echo "$FAILS Fehler.")"
exit $((FAILS > 0))
