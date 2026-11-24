# Testplan Pi – aktueller Stand

Ziel: Nachweisen, dass der aktuelle Stand (Einstellungen am Rahmen, Garmin, AthletePT, neues Admin-Panel und die Fixes vom 12.11.2026) auf dem Pi 3B+ so sauber läuft wie der ältere Stand.

Hilfsmittel: `ssh admin@rahmen.local`, Logs mit `journalctl -u trainingsrahmen -f` (bzw. `-u trainingsrahmen-hotspot`, `-u trainingsrahmen-kiosk`, `-u trainingsrahmen-update`), DevTools des Kiosks über `ssh -L 9222:localhost:9222 admin@rahmen.local` und `chrome://inspect`.

Jeden Punkt abhaken; was scheitert, mit Log-Auszug notieren.

## Systemtest-Skript `scripts/pi-check.sh`

Was ohne Hand und Auge geht, misst und prüft das Skript. Die mit 🤖 markierten Punkte unten deckt es ab; alles andere (Touch, PIR, Helligkeit nach Gefühl, Handy-Portal) bleibt Handarbeit.

| Aufruf | Wo | Wann |
|---|---|---|
| `./scripts/pi-check.sh` | Pi (`cd ~/trainingsrahmen`) | nach jedem Boot und am Ende jedes Abschnitts |
| `nohup ./scripts/pi-check.sh soak 48 &` | Pi | Start von Abschnitt 7, läuft 48 h im Hintergrund weiter |
| `./scripts/pi-check.sh remote` | PC (Git Bash), anderer Host per `FRAME_PI=…` | einmal in Abschnitt 2 |

**Momentaufnahme lesen.** Jede Zeile ist `OK`, `FEHLER` oder `·` (nur Info). Am Ende steht „Alles OK.“ oder die Zahl der Fehler; der Exit-Code ist dann 1.

| Abschnitt der Ausgabe | Gut | Wenn nicht |
|---|---|---|
| Boot | „Einschalten bis Plan: N s“ | Kiosk startet nicht: `journalctl -b -u trainingsrahmen-kiosk` |
| Ressourcen | RAM deutlich unter 1 GB, kaum Swap, `get_throttled=0x0` | Unterspannung → anderes Netzteil (5,1 V/2,5 A); viel Swap → Browser zu schwer |
| Dienste | beide laufen, 0 Neustarts, Hotspot mit `Restart=on-failure` | Neustarts → Log ansehen; fehlendes Restart → `install-services.sh` |
| Daemon | Commit = HEAD, Display verbunden | anderer Commit → Daemon neu starten oder Update hängt |
| Hardware | Backlight mit `max_brightness` > 1, gpiomon läuft | nur an/aus → Helligkeitsstufen ohne Wirkung |
| Netz | rahmen-wifi höchstens 2× angelegt/gelöscht | mehr → Neuanlage-Schleife, Fix aus Abschnitt 5 greift nicht |
| Log | keine Fehlermeldungen | die letzten 5 werden angezeigt; einmalige Sync-Fehler ohne Netz sind harmlos |

**Dauerlauf auswerten** (`data/soak.csv`, Spalten `zeit, ram_mb, swap_mb, browser_mb, temp_c, drossel, display, sync_fehler`):

- `ram_mb` und `browser_mb` pendeln, steigen aber nicht stetig (sonst Speicherleck im Display).
- `display` immer `ja`, `drossel` immer `0x0`, `temp_c` unter 70.
- `sync_fehler` nur vereinzelt, nicht dauerhaft.
- Zum Ansehen: `column -s, -t < data/soak.csv | less` oder die Datei am PC in eine Tabelle laden.

**Grenzen:** Die WLAN-Prüfung sucht in den Logs von NetworkManager nach `connection-add`/`connection-delete`. Das Format ist auf dem Pi noch nicht gesehen; einmal mit dem Handtest aus Abschnitt 5 gegenprüfen. Die Fehlersuche im Log geht nach Wörtern („error“, „Fehler“) und kann auch harmlose Meldungen zählen.

## 0. Aufspielen

- [x] Vorher notieren: `git -C ~/trainingsrahmen rev-parse --short HEAD` (alter Stand für den Rollback-Test).
- [x] Aktuellen Stand per **Update-Knopf** im Admin-Panel installieren (testet gleich den Normalfall).
  - Erwartet: „Lade Update“ → „Führe Update-Skript aus“ → „Starte neu“ → Erfolg; das Display lädt von selbst neu.
- [x] Danach einmal `~/trainingsrahmen/scripts/install-services.sh` ausführen. Der Update-Knopf bringt geänderte Units nicht mit, hier betrifft das `Restart=on-failure` in der Hotspot-Unit.
- [x] 🤖 `systemctl cat trainingsrahmen-hotspot | grep Restart` zeigt `Restart=on-failure`.

## 1. Grundbetrieb (Regression)

- [x] Nach `sudo reboot`: Plymouth-Splash → Kiosk mit Wochenraster, ohne weißes Aufblitzen und ohne Mauszeiger.
- [x] 🤖 Danach `./scripts/pi-check.sh` → „Alles OK.“; Bootzeit, RAM und Temperatur unten eintragen.
  - Bootzeit 41,4 s (Kernel 4,5 s + Userspace 36,9 s), Commit `f21843c`, keine Unterspannung oder Drosselung.
- [x] 🤖 Zeit vom Einschalten bis zum Plan stoppen: 59 s (Systemlaufzeit laut `pi-check.sh`).
- [x] 🤖 `free -m` nach 10 min: Speicher in Benutzung 416 MB, Swap 77 MB, verfügbar 488 MB von 905 MB. (Zum Vergleich nach 1 min: 449 MB, Swap 1 MB.)
- [x] 🤖 `vcgencmd measure_temp` nach 30 min: 44.0 °C. (Zum Vergleich nach 1 min: 49,4 °C.)
- [x] Tag antippen → Tagesansicht; „Weitere Einheiten“ antippen → Einheit groß; nach 60 s ohne Berührung zurück zum Plan.
- [x] Fußleiste antippen → Erholungs-Ansicht, Werte plausibel.
- [x] Wetter stimmt mit dem eingestellten Ort.

## 2. Einstellungen am Rahmen (neu)

Öffnen per Tipp auf das Sync-Symbol.

- [x] **Status:** WLAN-Name und Signal stimmen, jede Quelle mit Stand; „Jetzt synchronisieren“ dreht und aktualisiert die Zeit.
- [x] **Anzeige → Helligkeit:** Niedrig / Mittel / Hoch sind sichtbar verschieden. Nachts im dunklen Raum: Ist „Niedrig“ angenehm, nicht zu hell? Falls nicht, Werte in `daemon/system/pi.js` (`BRIGHTNESS`) anpassen.
  - [x] 🤖 `ls /sys/class/backlight/` und `cat /sys/class/backlight/*/max_brightness` notieren: `10-0045`, `max_brightness` 255
  - [x] Dimmt das Display stufenlos, oder kennt es nur an und aus?
- [x] **Anzeige → Theme und Ruhe-Fristen** ändern; die Werte stimmen danach im Admin-Panel.
- [ ] **Halten-Knöpfe** (WLAN ändern, Neustart, Herunterfahren):
  - [x] Kurz tippen löst nichts aus, der Balken läuft zurück.
  - [x] 2 s halten löst aus (zuerst „Neustart“ testen).
  - [x] Während des Haltens vom Knopf wegrutschen → bricht ab.
  - [x] Beim langen Drücken erscheint **kein** Kontextmenü und keine Textauswahl.
  - [x] Mit zwei Fingern gleichzeitig auf Neustart und Herunterfahren → höchstens eine Aktion.
- [x] 60 s ohne Berührung → zurück zum Plan.
- [x] 🤖 (`remote`) Von einem anderen Gerät aus: `curl -X POST -H 'content-type: application/json' -d '{}' http://rahmen.local:8080/api/frame/sync` liefert einen Fehler (nur localhost erlaubt).

## 3. Admin-Panel

- [x] Login, falsches Passwort fünfmal → 30 s gesperrt, danach geht es wieder.
- [x] **Fix Helligkeit:** Am Rahmen „Niedrig“ wählen, dann im Admin Theme oder ein Modul umschalten → die Helligkeit bleibt „Niedrig“.
- [x] Dienste: Trainingsplan (Server-URL und API-Key), Garmin- und AthletePT-Key speichern (falscher Key wird abgelehnt, richtiger gespeichert). Das Portal fragt diese Zugänge nicht mehr ab.
- [x] Slideshow: 2–3 Bilder hochladen; nach der Ruhe-Frist läuft die Slideshow mit Überblendung, danach geht das Display aus.

## 4. Ruhe, PIR und Wecken

- [x] Fristen kurz stellen (z. B. 1 und 2 min), weggehen → Slideshow → Display aus.
- [x] Vor den Sensor treten → Plan sofort zurück. Still sitzen bleiben → Plan bleibt, keine Slideshow. Weggehen → Fristen laufen erst ab dann (plus Haltezeit des Radars).
- [x] Im Zustand AUS antippen → weckt nur und öffnet keinen Tag.

## 5. WLAN und Hotspot

- [ ] **Fix WLAN-Neuanlage:** Router aus, dann `sudo systemctl restart trainingsrahmen`, 3 min warten.
  - 🤖 danach `pi-check.sh` (Zeile „rahmen-wifi … angelegt/gelöscht“), oder von Hand: `journalctl -u NetworkManager --since "-3 min" | grep -c rahmen-wifi` darf nicht im 30-s-Takt wachsen; keine Zeilen „connection added“ oder „deleted“.
  - Router wieder an → der Rahmen verbindet sich von selbst, das Display geht auf online.
- [ ] Router aus, ohne Daemon-Neustart → „Offline · Stand HH:MM“, der letzte Plan bleibt sichtbar.
- [ ] Über Nacht offline lassen (oder die Uhr über Mitternacht stellen) → **Fix Erholung:** Garmin-Werte von gestern erscheinen nach dem nächsten Neuladen nicht mehr als heute.
- [ ] „WLAN ändern“ (am Rahmen halten) → Hotspot `Rahmen-XXXX` erscheint, QR-Code funktioniert.
  - [x] Mit Android verbinden → das Portal öffnet sich von selbst.
  - [x] Mit iPhone verbinden → das Portal öffnet sich von selbst.
  - [ ] Falsches WLAN-Passwort → nach etwa 30 s Hotspot mit Fehlermeldung zurück.
  - [ ] Das Portal zeigt nur WLAN und Passwort.
  - [ ] Richtiges Passwort → verbunden, Plan erscheint; Admin-Passwort und Zugänge unter „Dienste“ bleiben erhalten.
- [ ] **Fix Hotspot-Neustart:** Während der Hotspot läuft `sudo pkill -9 hostapd` (mit `-9`, ein normales SIGTERM gilt für systemd als sauberes Ende) → nach ca. 3 s ist der Hotspot wieder sichtbar (`systemctl status trainingsrahmen-hotspot`).

## 6. Update und Rollback

- [x] **Bereits aktuell:** „Nach Updates suchen“ ohne neuen Commit → „Bereits aktuell“.
- [ ] **Lokale Änderungen:** `./scripts/deploy.sh` vom PC, dann einen neuen Commit pushen und im Admin „Installieren“ → Abbruch „Lokale Änderungen auf dem Rahmen“, nichts verändert. Danach `./scripts/deploy.sh --restore`.
- [ ] **Rollback:** Testbranch mit einem `scripts/update.sh`, das mit `exit 1` endet, pushen; im Admin den Branch einstellen und installieren → Meldung „Update-Skript fehlgeschlagen. Zurück auf dem vorherigen Stand“, `git rev-parse HEAD` zeigt den alten Commit, der Rahmen läuft normal.
- [ ] Danach den Branch im Admin wieder auf `master` stellen.

## 7. Dauerlauf und Strom

- [ ] 🤖 `nohup ./scripts/pi-check.sh soak 48 &` starten, 48 h laufen lassen, `data/soak.csv` wie oben auswerten. Hängt das Display oder ist es eingefroren? Sync-Zeit aktuell?
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
