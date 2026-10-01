# Entwicklung

Kurzanleitung zum Arbeiten am Trainingsrahmen. Was gebaut wird und warum, steht in `PLAN.md`.

## Starten

```
npm run dev
```

Display: `http://localhost:8080`. Es gibt keine Abhängigkeiten und keinen Build-Schritt; nach einer Änderung reicht ein Neuladen im Browser. Änderungen an `daemon/` brauchen einen Neustart.

| Parameter | Wirkung |
|---|---|
| `?theme=dark` / `?theme=light` | Farbschema erzwingen |
| `?now=2026-09-09T18:42` | Uhr verstellen (Wochentag, Nachtmodus) |

## Ordner

| Ordner | Inhalt |
|---|---|
| `display/` | Was auf dem 7-Zoll-Display läuft (HTML, CSS, JS, Schrift, Icons) |
| `daemon/` | Node-Prozess: liefert Display und API aus, später Zustände, Sync, Hardware |
| `fixtures/` | Testdaten statt echter Abrufe |

## Regeln

- **Keine npm-Abhängigkeiten** im Daemon und im Display. Auf dem Pi läuft kein `npm install`.
- **Nichts aus dem Internet laden.** Schrift, Icons und Skripte liegen lokal.
- **Farben nur über Variablen** aus `display/css/tokens.css`, nie fest im Markup.
- **Server-Format nur in `display/js/adapter.js`.** Der Rest kennt nur das interne Modell.
- **Hardware nur über den SystemAdapter** (ab Phase 3). Kein `nmcli`, GPIO oder Backlight direkt im übrigen Code.
- **Jeder Screen ist 1024 × 600** und muss ohne Scrollen passen.

## Fixtures

- `fixtures/data.json`: Plan mit allen Feldern.
- `fixtures/data.minimal.json`: heutiger Serverstand (nur `type` und `title`).
- `fixtures/weather.json`: Wetter.

Für Randfälle (leere Woche, drei Einheiten an einem Tag, sehr lange Titel) eine weitere Datei anlegen statt die vorhandenen zu ändern.

## Neues Icon

Die Icons sind Lucide 0.460.0 als Sprite in `display/assets/icons.svg`. Ein neues Icon als `<symbol id="i-NAME" viewBox="0 0 24 24">` mit dem Inhalt der Lucide-SVG ergänzen und per `icon("NAME")` verwenden.

## Phasen

Eine Phase gilt als fertig, wenn ihr Prüfpunkt erfüllt ist. Danach in `PLAN.md` abhaken und committen.

| Phase | Wo | Prüfpunkt |
|---|---|---|
| 1 Wochenraster | PC | Erledigt: 2A/2B rendern aus Fixtures wie im Mockup |
| 2 Messen | Pi | Display läuft im Kiosk; RAM, Startzeit und CPU-Temperatur notiert; Browser entschieden; PIR liefert ein Signal, Backlight schaltet |
| 3 Daemon | PC | Zustände wechseln über die Dev-Leiste; Display reagiert per SSE ohne Neuladen |
| 4 Tagesansicht | PC, dann Pi | Tipp auf einen Tag öffnet ihn groß; Rücksprung nach Tipp oder 60 s; Touch am Pi geprüft |
| 5 Einrichtung | PC, dann Pi | Ablauf 3A–3C läuft gegen den Mock; am Pi verbindet sich ein Handy per QR und trägt WLAN und Key ein |
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
