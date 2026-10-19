# Entwicklung

Kurzanleitung zum Arbeiten am Trainingsrahmen. Was gebaut wird und warum, steht in `PLAN.md`.

## Starten

```
npm run dev
```

Display: `http://localhost:8080`, Dev-Leiste: `http://localhost:8080/debug`. Es gibt keine Abhängigkeiten und keinen Build-Schritt; nach einer Änderung reicht ein Neuladen im Browser. Änderungen an `daemon/` brauchen einen Neustart.

`npm run dev` setzt `FRAME_ENV=dev` (aus `.env.dev`): Der Daemon nimmt den Mock-Adapter statt echter Hardware und schaltet die Dev-Leiste frei. `npm start` ist der Betrieb auf dem Pi und bricht ab, bis der Pi-Adapter existiert.

Einstellungen (WLAN, Server, Fristen) speichert der Daemon in `data/config.json`. Ein anderer Ort geht über `FRAME_DATA=…`. Datei löschen oder in der Dev-Leiste „Werkseinstellung“ drücken führt zurück in die Einrichtung.

| Parameter | Wirkung |
|---|---|
| `?theme=dark` / `?theme=light` | Farbschema erzwingen (Vorrang vor der Dev-Leiste) |
| `?now=2026-09-09T18:42` | Uhr verstellen (Wochentag, Nachtmodus; Vorrang vor der Dev-Leiste) |
| `?day=0` … `?day=6` | Tagesansicht für Montag … Sonntag offen halten, ohne Rücksprung nach 60 s |

## Display

| Datei | Inhalt |
|---|---|
| `display/js/display.js` | Zustand, Wochenraster, Platzhalter-Screens, Touch, SSE, Sync |
| `display/js/day.js` | Tagesansicht (Layout 1B) |
| `display/js/setup.js` | Einrichtungs-Screens 3A–3C |
| `display/js/adapter.js` | Server-Format → internes Modell |
| `display/js/util.js` | Formatierung, Icons, Silbentrennung |

Lange Titel bekommen über `hyphenate()` weiche Trennstriche, weil Chromium auf dem Pi offline kein deutsches Trenn-Wörterbuch hat. Ab drei Einheiten an einem Tag wird die Spalte kompakt; Titel werden nach drei bzw. vier Zeilen abgeschnitten.

## Dev-Leiste

Links das Display in 1024 × 600, rechts die Steuerung. Klicks ins Display zählen als Touch.

| Bereich | Was geht |
|---|---|
| Zustand | Beide Automaten, Fehler, Mock-Hardware (Hotspot, WLAN, Backlight, CPU) live |
| Einrichtung | Werkseinstellung, „Handy öffnet Portal“, Portal absenden, Zustand erzwingen |
| Ruhe | Bewegung (PIR), Zustand erzwingen, Fristen normal oder kurz (10 s / 30 s), Bilder vorhanden |
| Fehler simulieren | Falsches WLAN-Passwort, kein Internet, Server lehnt Key ab |
| Anzeige | Theme, Testplan aus `fixtures/`, Uhr verstellen |

## Zustände

| Automat | Ablauf |
|---|---|
| Einrichtung | `SETUP_HOTSPOT` → `SETUP_ACCOUNT` (Handy im Portal) → `READY` ⇄ `OFFLINE`. Scheitert das Absenden, kommt der Hotspot nach 30 s mit Fehler zurück. |
| Ruhe | `AKTIV` → `SLIDESHOW` → `AUS`, ohne Bilder direkt `AKTIV` → `AUS`. Touch oder Bewegung führt zurück; der erste Tipp außerhalb von `AKTIV` weckt nur. Läuft nur in `READY` und `OFFLINE`. |

Der Daemon schickt bei jeder Änderung die ganze Momentaufnahme über `/events` (SSE). Display, Portal und Dev-Leiste rendern daraus neu. Die Slideshow zeigt bis Phase 7 nur einen Platzhalter.

## Einrichtung testen

1. Dev-Leiste → „Werkseinstellung“: Das Display zeigt 3A mit WLAN-QR.
2. `http://localhost:8080/setup` öffnen (am besten in den DevTools in Handygröße). Das zählt als „Handy öffnet Portal“, das Display springt auf 3B.
3. WLAN wählen, Server-URL und API-Key eintragen, „Verbinden“. Fehler vorher in der Dev-Leiste einschalten, um 30 s Wartezeit und Rückkehr zu 3A zu sehen.

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
| `daemon/system/` | SystemAdapter: `mock.js` für den PC, `pi.js` für echte Hardware (noch leer) |
| `debug/` | Dev-Leiste, nur mit `FRAME_ENV=dev` erreichbar |
| `portal/` | Einrichtungsportal fürs Handy unter `/setup` |
| `fixtures/` | Testdaten statt echter Abrufe |
| `data/` | Laufzeitdaten wie `config.json`, nicht im Git |

## Regeln

- **Keine npm-Abhängigkeiten** im Daemon und im Display. Auf dem Pi läuft kein `npm install`.
- **Nichts aus dem Internet laden.** Schrift, Icons und Skripte liegen lokal.
- **Farben nur über Variablen** aus `display/css/tokens.css`, nie fest im Markup.
- **Server-Format nur in `display/js/adapter.js`.** Der Rest kennt nur das interne Modell.
- **Hardware nur über den SystemAdapter** (`daemon/system/`). Kein `nmcli`, GPIO oder Backlight direkt im übrigen Code.
- **Jeder Screen ist 1024 × 600** und muss ohne Scrollen passen.

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
| 6 Sync | PC, dann Pi | Echter Plan und Open-Meteo werden angezeigt; ohne Netz bleibt der letzte Stand mit „Offline" |
| 7 Admin | PC, dann Pi | Login, Einstellungen, Slideshow-Upload und Update-Knopf funktionieren; fehlgeschlagenes Update rollt zurück |
| 8 Härtung | Pi | Stecker ziehen im Betrieb, Pi startet wieder sauber in das Display |

Am PC wird gegen Mock und Fixtures entwickelt, am Pi nur geprüft, was echte Hardware braucht.

## Auf den Pi bringen

Kommt mit Phase 2: ein Deploy-Skript (Kopieren und Dienst-Neustart) und Remote-Debugging des Kiosk-Browsers über einen SSH-Tunnel. Bis dahin ist hier nichts eingerichtet.

## Messwerte vom Pi

In Phase 2 hier eintragen:

| Wert | Ergebnis |
|---|---|
| Browser | |
| RAM belegt im Leerlauf | |
| Zeit vom Einschalten bis zum Display | |
| CPU-Temperatur nach 30 min | |
