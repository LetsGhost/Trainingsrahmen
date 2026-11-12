# Testplan Pi – aktueller Stand

Ziel: Nachweisen, dass der aktuelle Stand (Einstellungen am Rahmen, Garmin, AthletePT, neues Admin-Panel und die Fixes vom 12.11.2026) auf dem Pi 3B+ so sauber läuft wie der ältere Stand.

Hilfsmittel: `ssh admin@rahmen.local`, Logs mit `journalctl -u trainingsrahmen -f` (bzw. `-u trainingsrahmen-hotspot`, `-u trainingsrahmen-kiosk`, `-u trainingsrahmen-update`), DevTools des Kiosks über `ssh -L 9222:localhost:9222 admin@rahmen.local` und `chrome://inspect`.

Jeden Punkt abhaken; was scheitert, mit Log-Auszug notieren.

**Automatisch (`scripts/pi-check.sh`):** Was ohne Hand und Auge geht, misst und prüft das Skript. Mit 🤖 markierte Punkte unten deckt es ab.

```
./scripts/pi-check.sh              # auf dem Pi nach jedem Boot: Bootzeit, RAM, Temperatur, Unterspannung,
                                   # Dienste, Commit, Backlight, gpiomon, WLAN-Neuanlage, Fehler im Log
nohup ./scripts/pi-check.sh soak 48 &   # Dauerlauf, alle 5 min eine Zeile nach data/soak.csv
./scripts/pi-check.sh remote       # vom PC (Git Bash): /api/frame/* von außen gesperrt?
```

## 0. Aufspielen

- [ ] Vorher notieren: `git -C ~/trainingsrahmen rev-parse --short HEAD` (alter Stand für den Rollback-Test).
- [ ] Aktuellen Stand per **Update-Knopf** im Admin-Panel installieren (testet gleich den Normalfall).
  - Erwartet: „Lade Update“ → „Führe Update-Skript aus“ → „Starte neu“ → Erfolg; das Display lädt von selbst neu.
- [ ] Danach einmal `~/trainingsrahmen/scripts/install-services.sh` ausführen. Der Update-Knopf bringt geänderte Units nicht mit, hier betrifft das `Restart=on-failure` in der Hotspot-Unit.
- [ ] 🤖 `systemctl cat trainingsrahmen-hotspot | grep Restart` zeigt `Restart=on-failure`.

## 1. Grundbetrieb (Regression)

- [ ] Nach `sudo reboot`: Plymouth-Splash → Kiosk mit Wochenraster, ohne weißes Aufblitzen und ohne Mauszeiger.
- [ ] 🤖 Zeit vom Einschalten bis zum Plan stoppen: ____ s.
- [ ] 🤖 `free -m` nach 10 min: Speicher in Benutzung ____ MB, Swap ____ MB.
- [ ] 🤖 `vcgencmd measure_temp` nach 30 min: ____ °C.
- [ ] Tag antippen → Tagesansicht; „Weitere Einheiten“ antippen → Einheit groß; nach 60 s ohne Berührung zurück zum Plan.
- [ ] Fußleiste antippen → Erholungs-Ansicht, Werte plausibel.
- [ ] Wetter stimmt mit dem eingestellten Ort.

## 2. Einstellungen am Rahmen (neu)

Öffnen per Tipp auf das Sync-Symbol.

- [ ] **Status:** WLAN-Name und Signal stimmen, jede Quelle mit Stand; „Jetzt synchronisieren“ dreht und aktualisiert die Zeit.
- [ ] **Anzeige → Helligkeit:** Niedrig / Mittel / Hoch sind sichtbar verschieden. Nachts im dunklen Raum: Ist „Niedrig“ angenehm, nicht zu hell? Falls nicht, Werte in `daemon/system/pi.js` (`BRIGHTNESS`) anpassen.
  - [ ] 🤖 `ls /sys/class/backlight/` und `cat /sys/class/backlight/*/max_brightness` notieren: ____
  - [ ] Dimmt das Display stufenlos, oder kennt es nur an und aus?
- [ ] **Anzeige → Theme und Ruhe-Fristen** ändern; die Werte stimmen danach im Admin-Panel.
- [ ] **Halten-Knöpfe** (WLAN ändern, Neustart, Herunterfahren):
  - [ ] Kurz tippen löst nichts aus, der Balken läuft zurück.
  - [ ] 2 s halten löst aus (zuerst „Neustart“ testen).
  - [ ] Während des Haltens vom Knopf wegrutschen → bricht ab.
  - [ ] Beim langen Drücken erscheint **kein** Kontextmenü und keine Textauswahl.
  - [ ] Mit zwei Fingern gleichzeitig auf Neustart und Herunterfahren → höchstens eine Aktion.
- [ ] 60 s ohne Berührung → zurück zum Plan.
- [ ] 🤖 (`remote`) Von einem anderen Gerät aus: `curl -X POST -H 'content-type: application/json' -d '{}' http://rahmen.local:8080/api/frame/sync` liefert einen Fehler (nur localhost erlaubt).

## 3. Admin-Panel

- [ ] Login, falsches Passwort fünfmal → 30 s gesperrt, danach geht es wieder.
- [ ] **Fix Helligkeit:** Am Rahmen „Niedrig“ wählen, dann im Admin Theme oder ein Modul umschalten → die Helligkeit bleibt „Niedrig“.
- [ ] Dienste: Garmin- und AthletePT-Key speichern (falscher Key wird abgelehnt, richtiger gespeichert).
- [ ] Slideshow: 2–3 Bilder hochladen; nach der Ruhe-Frist läuft die Slideshow mit Überblendung, danach geht das Display aus.

## 4. Ruhe, PIR und Wecken

- [ ] Fristen kurz stellen (z. B. 1 und 2 min), weggehen → Slideshow → Display aus.
- [ ] Vor den Sensor treten → Plan sofort zurück. Kommen Bewegungen ohne Verzögerung an? Wenn nicht: gpiomon puffert die Ausgabe, Abhilfe `stdbuf -oL`.
- [ ] Im Zustand AUS antippen → weckt nur und öffnet keinen Tag.

## 5. WLAN und Hotspot

- [ ] **Fix WLAN-Neuanlage:** Router aus, dann `sudo systemctl restart trainingsrahmen`, 3 min warten.
  - 🤖 danach `pi-check.sh` (Zeile „rahmen-wifi … angelegt/gelöscht“), oder von Hand: `journalctl -u NetworkManager --since "-3 min" | grep -c rahmen-wifi` darf nicht im 30-s-Takt wachsen; keine Zeilen „connection added“ oder „deleted“.
  - Router wieder an → der Rahmen verbindet sich von selbst, das Display geht auf online.
- [ ] Router aus, ohne Daemon-Neustart → „Offline · Stand HH:MM“, der letzte Plan bleibt sichtbar.
- [ ] Über Nacht offline lassen (oder die Uhr über Mitternacht stellen) → **Fix Erholung:** Garmin-Werte von gestern erscheinen nach dem nächsten Neuladen nicht mehr als heute.
- [ ] „WLAN ändern“ (am Rahmen halten) → Hotspot `Rahmen-XXXX` erscheint, QR-Code funktioniert.
  - [ ] Mit Android verbinden → das Portal öffnet sich von selbst.
  - [ ] Mit iPhone verbinden → das Portal öffnet sich von selbst.
  - [ ] Falsches WLAN-Passwort → nach etwa 30 s Hotspot mit Fehlermeldung zurück.
  - [ ] Richtiges Passwort → verbunden, Plan erscheint; das Admin-Passwort bleibt erhalten.
- [ ] **Fix Hotspot-Neustart:** Während der Hotspot läuft `sudo pkill -9 hostapd` (mit `-9`, ein normales SIGTERM gilt für systemd als sauberes Ende) → nach ca. 3 s ist der Hotspot wieder sichtbar (`systemctl status trainingsrahmen-hotspot`).

## 6. Update und Rollback

- [ ] **Bereits aktuell:** „Nach Updates suchen“ ohne neuen Commit → „Bereits aktuell“.
- [ ] **Lokale Änderungen:** `./scripts/deploy.sh` vom PC, dann einen neuen Commit pushen und im Admin „Installieren“ → Abbruch „Lokale Änderungen auf dem Rahmen“, nichts verändert. Danach `./scripts/deploy.sh --restore`.
- [ ] **Rollback:** Testbranch mit einem `scripts/update.sh`, das mit `exit 1` endet, pushen; im Admin den Branch einstellen und installieren → Meldung „Update-Skript fehlgeschlagen. Zurück auf dem vorherigen Stand“, `git rev-parse HEAD` zeigt den alten Commit, der Rahmen läuft normal.
- [ ] Danach den Branch im Admin wieder auf `master` stellen.

## 7. Dauerlauf und Strom

- [ ] 🤖 (`soak`) 48 h laufen lassen. Danach `free -m`: Speicher ungefähr wie bei Punkt 1? Hängt das Display oder ist es eingefroren? Sync-Zeit aktuell?
- [ ] 🤖 `pi-check.sh` nach dem Dauerlauf: keine Fehlermeldungen, keine Neustarts der Dienste.
- [ ] Im Betrieb den Stecker ziehen und wieder einstecken → startet normal, Einstellungen und Bilder sind noch da.

## Ergebnis

| Bereich | OK? | Notiz |
|---|---|---|
| 0 Aufspielen | | |
| 1 Grundbetrieb | | |
| 2 Einstellungen am Rahmen | | |
| 3 Admin | | |
| 4 Ruhe/PIR | | |
| 5 WLAN/Hotspot | | |
| 6 Update/Rollback | | |
| 7 Dauerlauf | | |

Sind alle Bereiche grün, ist der Stand v1-tauglich. Danach optional: Logs ins RAM (`Storage=volatile`), WLAN-Stromsparen aus, Read-only-Root.
