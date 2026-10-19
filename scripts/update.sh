#!/usr/bin/env bash
# Läuft nach jedem git pull des Update-Knopfs, aus dem neuen Stand und im App-Verzeichnis.
# Hier kommen Schritte hin, die ein Update braucht (Dateien verschieben, Daten umbauen …).
# Abhängigkeiten werden nicht installiert: Der Daemon kommt ohne aus, auf dem Pi läuft kein npm install.
# Endet das Skript mit einem Fehler, geht self-update.sh auf den vorherigen Commit zurück.
set -euo pipefail

# Bisher keine Schritte nötig.
exit 0
