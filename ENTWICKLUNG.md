# Entwicklung

Kurzanleitung zum Arbeiten am Trainingsrahmen. Was gebaut wird und warum, steht in `PLAN.md`.

## Starten

```
npm run dev
```

Display: `http://localhost:8080`, Dev-Leiste: `http://localhost:8080/debug`. Es gibt keine Abhängigkeiten und keinen Build-Schritt; nach einer Änderung reicht ein Neuladen im Browser. Änderungen an `daemon/` brauchen einen Neustart.

`npm run dev` setzt `FRAME_ENV=dev` (aus `.env.dev`): Der Daemon nimmt den Mock-Adapter statt echter Hardware und schaltet die Dev-Leiste frei. `npm start` ist der Betrieb auf dem Pi mit dem Pi-Adapter (`nmcli`, `gpiomon`, sysfs). `npm run demo` startet den Demo-Modus (siehe unten).

Einstellungen (WLAN, Server, Fristen) speichert der Daemon in `data/config.json`. Ein anderer Ort geht über `FRAME_DATA=…`. Datei löschen oder in der Dev-Leiste „Werkseinstellung“ drücken führt zurück in die Einrichtung.

| Parameter | Wirkung |
|---|---|
| `?theme=dark` / `?theme=light` | Farbschema erzwingen (Vorrang vor der Dev-Leiste) |
| `?now=2026-09-09T18:42` | Uhr verstellen (Wochentag, Nachtmodus; Vorrang vor der Dev-Leiste) |
| `?day=0` … `?day=6` | Tagesansicht für Montag … Sonntag offen halten, ohne Rücksprung nach 60 s |

## Display

| Datei | Inhalt |
|---|---|
| `display/js/display.js` | Zustand, Wochenraster, Slideshow-Platzhalter, Touch, SSE, Laden vom Daemon |
| `display/js/day.js` | Tagesansicht (Layout 1B) |
| `display/js/setup.js` | Einrichtungs-Screens 3A–3C und Admin-Schritt |
| `display/js/slideshow.js` | Slideshow mit zwei `<img>` und Überblendung |
| `display/js/adapter.js` | Server-Format → internes Modell |
| `display/js/util.js` | Formatierung, Icons, Silbentrennung |

Lange Titel bekommen über `hyphenate()` weiche Trennstriche, weil Chromium auf dem Pi offline kein deutsches Trenn-Wörterbuch hat. Ab drei Einheiten an einem Tag wird die Spalte kompakt; Titel werden nach drei bzw. vier Zeilen abgeschnitten.

## Dev-Leiste

Links das Display in 800 × 480, rechts die Steuerung. Klicks ins Display zählen als Touch.

| Bereich | Was geht |
|---|---|
| Zustand | Beide Automaten, Fehler, Mock-Hardware (Hotspot, WLAN, Backlight, CPU) live |
| Einrichtung | Werkseinstellung, „Handy öffnet Portal“, Portal absenden, Zustand erzwingen |
| Ruhe | Bewegung (PIR), Zustand erzwingen, Fristen normal oder kurz (10 s / 30 s) |
| Fehler simulieren | Falsches WLAN-Passwort, kein Internet, Server lehnt Key ab |
| Anzeige | Theme, Testplan aus `fixtures/`, Uhr verstellen |

## Zustände

| Automat | Ablauf |
|---|---|
| Einrichtung | `SETUP_HOTSPOT` → `SETUP_ACCOUNT` (Handy im Portal) → `SETUP_ADMIN` (nur ohne Admin-Passwort) → `READY` ⇄ `OFFLINE`. Scheitert das Absenden, kommt der Hotspot nach 30 s mit Fehler zurück. |
| Ruhe | `AKTIV` → `SLIDESHOW` → `AUS`, ohne Bilder direkt `AKTIV` → `AUS`. Touch oder Bewegung führt zurück; der erste Tipp außerhalb von `AKTIV` weckt nur. Läuft nur in `READY` und `OFFLINE`. |

Der Daemon schickt bei jeder Änderung die ganze Momentaufnahme über `/events` (SSE). Display, Portal und Dev-Leiste rendern daraus neu. Die Slideshow zeigt bis Phase 7 nur einen Platzhalter.

## Sync

Der Daemon holt den Plan alle 10 min (`GET {url}/data` mit `x-api-key`) und das Wetter alle 30 min von Open-Meteo, aber nur in `READY`. Beim Wechsel nach `READY` gleicht er sofort ab. Beides landet in `data/cache/`; nach einem Neustart ohne Netz zeigt das Display den letzten Stand.

- `/api/plan` liefert den Plan im Server-Format (übersetzt wird weiter nur in `display/js/adapter.js`), `/api/weather` das fertige Wetter-Modell. Ohne Stand: 404.
- Das Display lädt beides neu, sobald sich `planAt` oder `weatherAt` in `/events` ändern; ein eigenes Intervall hat es nicht mehr.
- Fußzeile: „Sync HH:MM“, bei Fehler die Meldung mit „Stand HH:MM“, ohne Netz „Offline · Stand HH:MM“.
- In der Entwicklung kommen Plan und Wetter aus `fixtures/`. In der Dev-Leiste unter „Sync“ schalten „Echter Server“ (URL und Key aus der Einrichtung) und „Echtes Wetter“ auf echte Abrufe um.
- Die Antwort des Servers muss gültiges JSON mit einem Array `trainingsweek` sein, sonst gilt der Abruf als fehlgeschlagen und der alte Stand bleibt.

## Admin

`/admin` zeigt je nach Zustand „Passwort festlegen“ (nur in `SETUP_ADMIN`, mit Einmal-Code), „Anmelden“ oder das Panel.

- Passwort als scrypt-Hash in `config.json`; nach 5 Fehlversuchen 30 s Sperre.
- Sitzung per Cookie (`HttpOnly`, `SameSite=Strict`, 12 h, nur im Speicher: Neustart meldet ab). Schreibende Anfragen verlangen JSON.
- Panel: Server und API-Key (wird vor dem Speichern geprüft), Wetter-Ort (Suche über Open-Meteo), Erscheinungsbild, Module Wetter und Erholung, Ruhe-Fristen, Status, „Jetzt neu laden“, „WLAN ändern“, Passwort ändern.
- Slideshow: Bilder werden im Browser auf 800 × 480 zugeschnitten und als JPEG hochgeladen; der Daemon prüft den Dateianfang, höchstens 200 Bilder, je 3 MB. Ablage in `data/slides/`.
- `/api/slides` liefert die Bilder an das Display (localhost) und an angemeldete Admins.

## Update per Knopf

Admin-Panel → „Software“: „Nach Updates suchen“ macht `git fetch` von `config.update` (Standard `origin/master`) und listet neue Commits; „Installieren“ startet `scripts/self-update.sh`. Das zieht, führt `scripts/update.sh` aus, startet den Daemon neu und wartet, bis `/health` den neuen Commit meldet. Sonst geht es zurück auf den vorherigen Commit.

- Schritte, die ein Update braucht, gehören in `scripts/update.sh`. Endet es mit Fehler, wird zurückgerollt.
- In der Entwicklung verweigert der Daemon „Installieren“, solange `FRAME_UPDATE_DIR` nicht auf einen Test-Klon zeigt. So zieht ein Klick nie in dieses Arbeitsverzeichnis.
- Zum Testen: Bare-Repo als Remote anlegen, davon einen Klon als App starten (`FRAME_UPDATE_DIR` = Klon, `FRAME_RESTART_CMD` = Skript, das den Daemon neu startet), in einem zweiten Klon Commits pushen.
- Shell-Skripte müssen LF-Zeilenenden haben (`.gitattributes`) und ausführbar sein (`git update-index --chmod=+x`).

## Einrichtung testen

1. Dev-Leiste → „Werkseinstellung“: Das Display zeigt 3A mit WLAN-QR.
2. `http://localhost:8080/setup` öffnen (am besten in den DevTools in Handygröße). Das zählt als „Handy öffnet Portal“, das Display springt auf 3B.
3. WLAN wählen, Server-URL und API-Key eintragen, „Verbinden“. Fehler vorher in der Dev-Leiste einschalten, um 30 s Wartezeit und Rückkehr zu 3A zu sehen.
4. Das Display zeigt den Admin-Schritt. Die Dev-Leiste zeigt den Einmal-Code; `http://localhost:8080/admin?code=…` öffnen und ein Passwort festlegen.

Mit einem echten Handy: Der QR-Code auf 3B zeigt auf die LAN-Adresse des PCs. Ist das Handy im selben WLAN, öffnet es das Portal direkt. Unter Windows muss die Firewall Node für private Netze zulassen.

| Route | Zweck |
|---|---|
| `GET /setup` | Portal; meldet dem Daemon „Portal geöffnet“ |
| `GET /api/setup/networks` | WLAN-Liste vom Adapter |
| `POST /api/setup` | `{ wifi: { ssid, password }, server: { url, apiKey } }`; antwortet sofort mit 202, verbindet danach |
| `GET /api/setup/qr/wifi.svg`, `…/portal.svg` | QR-Codes für 3A und 3B |

## Ordner

| Ordner | Inhalt |
|---|---|
| `display/` | Was auf dem 7-Zoll-Display läuft (HTML, CSS, JS, Schrift, Icons) |
| `daemon/` | Node-Prozess: Server, Zustandsautomaten (`state.js`), Einstellungen, Server-Prüfung |
| `daemon/system/` | SystemAdapter: `mock.js` für den PC, `pi.js` für echte Hardware (noch nicht auf dem Pi geprüft) |
| `debug/` | Dev-Leiste, nur mit `FRAME_ENV=dev` erreichbar |
| `portal/` | Einrichtungsportal fürs Handy unter `/setup` |
| `admin/` | Admin-Bereich unter `/admin` (Login, Panel, Slideshow, Update) |
| `scripts/` | Einrichtung (`setup-pi.sh`, `install-services.sh`), `deploy.sh` vom PC, `kiosk.sh`, `demo.sh`, `factory-reset.sh`, Update (`self-update.sh`, `update.sh`), Vorlagen in `systemd/` und `system/` |
| `fixtures/` | Testdaten statt echter Abrufe |
| `data/` | Laufzeitdaten wie `config.json`, `frame.env`, im Demo-Modus `demo/`; nicht im Git |

## Regeln

- **Keine npm-Abhängigkeiten** im Daemon und im Display. Auf dem Pi läuft kein `npm install`.
- **Nichts aus dem Internet laden.** Schrift, Icons und Skripte liegen lokal.
- **Farben nur über Variablen** aus `display/css/tokens.css`, nie fest im Markup.
- **Server-Format nur in `display/js/adapter.js`.** Der Rest kennt nur das interne Modell.
- **Hardware nur über den SystemAdapter** (`daemon/system/`). Kein `nmcli`, GPIO oder Backlight direkt im übrigen Code.
- **Jeder Screen ist 800 × 480** (Waveshare 7" DSI) und muss ohne Scrollen passen. Maße aus den Vorlagen (1024 × 600) mit ≈ 0,78 umrechnen, Schrift nicht unter 9 px.

## Fixtures

- `fixtures/data.json`: Plan mit allen Feldern.
- `fixtures/data.minimal.json`: heutiger Serverstand (nur `type` und `title`).
- `fixtures/data.empty.json`: leere Woche.
- `fixtures/data.full.json`: drei Einheiten an einem Tag, lange Titel, unbekannter Sport, 5 h am Stück.
- `fixtures/weather.json`: Wetter, `forecast` sind sieben Tage ab heute (für die Tagesansicht).

Neue `data*.json`-Dateien erscheinen ohne Neustart in der Dev-Leiste unter „Testplan“.

Für Randfälle (leere Woche, drei Einheiten an einem Tag, sehr lange Titel) eine weitere Datei anlegen statt die vorhandenen zu ändern.

## Neues Icon

Die Icons sind Lucide 0.460.0 als Sprite in `display/assets/icons.svg`. Ein neues Icon als `<symbol id="i-NAME" viewBox="0 0 24 24">` mit dem Inhalt der Lucide-SVG ergänzen und per `icon("NAME")` verwenden.

## Phasen

Eine Phase gilt als fertig, wenn ihr Prüfpunkt erfüllt ist. Danach in `PLAN.md` abhaken und committen.

| Phase | Wo | Prüfpunkt |
|---|---|---|
| 1 Wochenraster | PC | Erledigt: 2A/2B rendern aus Fixtures wie im Mockup |
| 2 Messen | Pi (verschoben) | Display läuft im Kiosk; RAM, Startzeit und CPU-Temperatur notiert; Browser entschieden; PIR liefert ein Signal, Backlight schaltet |
| 3 Daemon | PC | Erledigt: Zustände wechseln über die Dev-Leiste; Display reagiert per SSE ohne Neuladen |
| 4 Tagesansicht | PC, dann Pi | Am PC erledigt, Touch am Pi offen: Tipp auf einen Tag öffnet ihn groß; Rücksprung nach Tipp oder 60 s; Touch am Pi geprüft |
| 5 Einrichtung | PC, dann Pi | Gegen den Mock erledigt, Pi offen: Ablauf 3A–3C läuft gegen den Mock; am Pi verbindet sich ein Handy per QR und trägt WLAN und Key ein |
| 6 Sync | PC, dann Pi | Am PC erledigt, echter Server offen: Echter Plan und Open-Meteo werden angezeigt; ohne Netz bleibt der letzte Stand mit „Offline" |
| 7 Admin | PC, dann Pi | Am PC erledigt, Pi offen: Login, Einstellungen, Slideshow-Upload und Update-Knopf funktionieren; fehlgeschlagenes Update rollt zurück |
| 8 Härtung | Pi | Stecker ziehen im Betrieb, Pi startet wieder sauber in das Display |

Am PC wird gegen Mock und Fixtures entwickelt, am Pi nur geprüft, was echte Hardware braucht.

## Auf den Pi bringen

Wie bei der Slotmaschine: Repo auf dem Pi klonen, ein Skript richtet alles ein. Der Pi läuft mit Pi OS Lite (64-bit, ab Bookworm), User `admin`, Repo unter `~/trainingsrahmen`.

**Neue SD-Karte**

1. Im Pi Imager Pi OS Lite (64-bit) flashen: User `admin`, Hostname `rahmen`, SSH an, WLAN eintragen (nur für die Installation).
2. Auf dem Pi:
   ```
   sudo apt install -y git
   git clone https://github.com/LetsGhost/Trainingsrahmen.git ~/trainingsrahmen
   cd ~/trainingsrahmen && ./scripts/setup-pi.sh
   sudo reboot
   ```
3. Nach dem Neustart zeigt das Display 3A. Ab hier läuft die Einrichtung per Handy. Weil der Hotspot das einzige Funkmodul belegt, ist der Pi bis dahin nicht im Heim-WLAN; SSH geht dann nur per LAN-Kabel.

`setup-pi.sh` installiert Pakete (Node, cage, Chromium, NetworkManager, gpiod), setzt WLAN-Land und Hostname, schaltet I2C an und trägt das Display-Overlay `dtoverlay=vc4-kms-dsi-7inch` in `config.txt` ein (anderes über `FRAME_DSI_OVERLAY=…`, `none` lässt die Datei in Ruhe), trägt den User in die Gruppen ein, schaltet Boot-Meldungen auf tty3 und ruft `install-services.sh` auf. Es kann gefahrlos mehrfach laufen.

**Dienste**

| Unit | Inhalt |
|---|---|
| `trainingsrahmen.service` | Daemon (`node daemon/server.js`), zusätzlich auf Port 80 fürs Portal |
| `trainingsrahmen-kiosk.service` | `scripts/kiosk.sh`: Chromium in cage auf tty1 |
| `trainingsrahmen-update.service` | Update per Knopf (`scripts/self-update.sh`), nur auf Anforderung |
| `trainingsrahmen-touch.service` | `scripts/touch-rebind.sh` beim Booten: Touch-Treiber neu binden (siehe unten) |
| `trainingsrahmen-hotspot.service` | Hotspot der Einrichtung: hostapd + dnsmasq auf wlan0, startet nur der Daemon. Nicht über NetworkManager: Dessen AP-Modus kündigt auch WPA-PSK-SHA256 an, daran scheitert der BCM43430 (Handy: „Passwort falsch“). |

`install-services.sh` setzt User und Pfad in die Vorlagen aus `scripts/systemd/` ein und installiert dazu aus `scripts/system/`: die polkit-Regel (der User darf ohne Passwort WLAN schalten und seine Units starten) und die Backlight-Regel. Nach Änderungen an diesen Dateien neu ausführen; `deploy.sh` macht das selbst. `scripts/update.sh` läuft ohne sudo und kann das nicht.

**Vom PC aus testen (ohne Commit)**

```
./scripts/deploy.sh                  # an admin@rahmen.local, oder FRAME_PI=… bzw. Adresse als Argument
./scripts/deploy.sh --restore        # Pi zurück auf den committeten Stand
```

`deploy.sh` (Git Bash) kopiert alle Dateien, die git kennt oder nicht ignoriert, mit LF-Zeilenenden auf den Pi, führt `install-services.sh` aus und wartet auf `/health`. `data/` bleibt. Solange Änderungen von `deploy.sh` auf dem Pi liegen, scheitert der Update-Knopf absichtlich (`git pull --ff-only`); `--restore` räumt auf. Mit einem SSH-Key (`ssh-copy-id admin@rahmen.local`) fragt es nicht mehrfach nach dem Passwort.

**Updates**: Commit pushen, dann im Admin-Panel „Nach Updates suchen“ und „Installieren“. Das Display lädt nach dem Neustart des Daemons selbst neu, sobald es einen anderen Commit sieht.

**Kiosk** (`scripts/kiosk.sh`, übernommen aus `start.sh` der Slotmaschine): wartet auf den Daemon und auf das Display, blendet den Mauszeiger aus, setzt das Chromium-Profil nach wiederholten Abstürzen zurück und räumt Sperrdateien nach Stromausfall weg. Hängt das Display nicht binnen 90 s an `/events` oder ist es danach 60 s weg, endet das Skript und systemd startet neu (`/health` meldet `display`). Schalter in `data/frame.env`:

| Schalter | Wirkung |
|---|---|
| `FRAME_ROTATION=90` | Bild drehen (`normal`, `90`, `180`, `270`). Touch dreht nicht mit; dafür wie bei der Slotmaschine eine udev-Regel mit `LIBINPUT_CALIBRATION_MATRIX` anlegen |
| `FRAME_PIR_PIN=17` | GPIO des PIR (Standard 17, `off` schaltet ab); `FRAME_PIR_CHIP` Standard `gpiochip0` |
| `FRAME_CHROMIUM_FLAGS="--disable-gpu"` | zusätzliche Chromium-Flags |
| `FRAME_HIDE_CURSOR=0` | Mauszeiger sichtbar |

Nach einer Änderung: `sudo systemctl restart trainingsrahmen trainingsrahmen-kiosk`.

**Fehlersuche**

- Logs: `journalctl -u trainingsrahmen -f` (Daemon), `journalctl -t trainingsrahmen-kiosk -f` (Kiosk, nicht `-u`, siehe Kommentar in der Unit).
- Touch reagiert nicht, obwohl das Bild läuft: Der Touch-Chip ist beim Booten oft noch nicht bereit (`dmesg`: `I2C communication failure: -5`). `trainingsrahmen-touch.service` bindet den Treiber dann neu (Goodix an `0x5d`/`0x14` oder FT5x06 an `0x38`, je nach Waveshare-Version). Logs: `journalctl -u trainingsrahmen-touch`; prüfen mit `sudo libinput list-devices`.
- Das Display ist nativ quer (800 × 480), `FRAME_ROTATION` bleibt also auf `normal`.
- DevTools des Kiosk-Browsers: `ssh -L 9222:localhost:9222 admin@rahmen.local`, dann am PC `chrome://inspect` → `localhost:9222`.
- Den Pi nicht per Stecker ausschalten (`sudo poweroff`). Bei der Slotmaschine hat ein Stromausfall schon Chromium-Dateien zerstört; Prüfen mit `sudo dpkg --verify`. Read-only-Root kommt mit Phase 8.

## Demo-Modus

Zum Vorführen ohne WLAN, Server und Einrichtung:

```
./scripts/demo.sh on [--fresh]    # auf dem Pi; --fresh löscht vorher die Demo-Daten
./scripts/demo.sh off
npm run demo                      # am PC
```

- Startet direkt im Plan mit Testplan und Testwetter aus `fixtures/`, kurze Ruhe-Fristen (1 / 3 min), Fußzeile „Demo · Sync …“.
- WLAN, Hotspot und Internet werden nur gespielt (`daemon/demo.js`); Backlight, PIR und CPU-Temperatur sind echt. „WLAN ändern“ im Admin-Bereich führt durch die Einrichtung, das Portal liegt dann unter der normalen LAN-Adresse.
- Admin-Passwort `demo1234`.
- Einstellungen, Cache und Bilder liegen unter `data/demo/`, die echte Einrichtung bleibt unberührt. Der Schalter steht als `FRAME_DEMO=1` in `data/frame.env`.

## Werkseinstellung

```
./scripts/factory-reset.sh        # fragt nach; -y ohne Nachfrage
```

Löscht `data/` komplett (WLAN, Server, Admin-Passwort, Cache, Slideshow-Bilder, Demo-Schalter, Update-Status), die WLAN-Verbindungen `rahmen-wifi` und `rahmen-hotspot` in NetworkManager und das Kiosk-Profil, dann startet der Daemon in der Einrichtung. Code und Pi OS bleiben. Am PC löscht es nur `data/`; der Daemon muss dann von Hand neu starten. Die Werkseinstellung der Dev-Leiste setzt dagegen nur WLAN, Server und Passwort zurück.

## Messwerte vom Pi

In Phase 2 hier eintragen:

| Wert | Ergebnis |
|---|---|
| Browser | |
| RAM belegt im Leerlauf | |
| Zeit vom Einschalten bis zum Display | |
| CPU-Temperatur nach 30 min | |
