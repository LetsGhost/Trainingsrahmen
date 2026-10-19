# Trainingsrahmen – Plan

Kiosk-Anzeige für einen Raspberry Pi 3B+ mit 7-Zoll-Touch-Display (DSI, 1024 × 600).
Designvorlagen: `Trainingsrahmen.dc.html` (Layouts 2A/2B, 1B, 1D, 1E) und `Einrichtung.dc.html` (3A–3C).

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Gerät | Ein Pi 3B+ für eine Person |
| Daten | `GET /data` mit Header `x-api-key` vom Sport-Analytics-Backend; Server bleibt unverändert |
| Wetter | Open-Meteo direkt vom Pi, ohne Key; Ort im Admin-Bereich einstellbar (Standard Berlin) |
| Hauptscreen | Wochenraster 2A (dunkel, 22–06 Uhr) / 2B (hell) |
| Touch | Tag antippen öffnet die Tagesansicht (1B); Tipp oder 60 s ohne Berührung führt zurück |
| Einrichtung | Hotspot `Rahmen-XXXX`; das Handy trägt im Portal WLAN, Server-URL und API-Key ein; danach führt ein QR-Code mit Einmal-Code in den Admin-Bereich, wo das Admin-Passwort festgelegt wird |
| Admin | Login und Panel unter `rahmen.local:8080/admin`, nur im Heimnetz; Passwort als scrypt-Hash, Sitzung 12 h |
| Updates | Git-Repo, nur per Knopf im Admin-Panel |
| Ruhe | Plan → Slideshow → Display aus; Bewegung oder Touch führt zurück zum Plan |
| Sensor | Seeed Grove Mini-PIR an einem GPIO-Pin |
| Slideshow | Nur Bilder, Upload über das Admin-Panel |

## Architektur

```
Pi OS Lite 64-bit (kein Desktop)
 ├─ cage (Wayland-Kiosk) → Browser → http://localhost:8080/display
 └─ Daemon (Node, ohne Abhängigkeiten, systemd)
     ├─ HTTP: /display, /setup (Captive Portal), /admin, /api, /events (SSE)
     ├─ Einrichtung: SETUP_HOTSPOT → SETUP_ACCOUNT → READY ⇄ OFFLINE
     ├─ Ruhe:        AKTIV → SLIDESHOW → AUS
     ├─ Sync: Plan, Wetter → Cache auf der Daten-Partition
     └─ SystemAdapter: WLAN, Hotspot, PIR, Backlight, CPU-Temperatur
```

## Server-Format

```json
{
  "trainingsweek": [
    {
      "day": "Montag",
      "training": [
        {
          "type": "running",
          "title": "Dauerlauf 1",
          "time": "06:45",
          "duration": 55,
          "intensity": "RPE 4",
          "description": "Locker im Grundlagenbereich."
        }
      ]
    }
  ],
  "recovery": { "score": 78, "sleepMinutes": 432, "hrv": 62, "restingHr": 48 }
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `day` | ja | Deutscher Wochentag, „Montag" bis „Sonntag" |
| `type` | ja | `running`, `biking`, `swimming`, `weightLifting`; alles andere wird „Sonstiges" |
| `title` | ja | Name der Einheit |
| `time` | nein | Startzeit als `"HH:MM"` |
| `duration` | nein | Dauer in Minuten (Zahl) |
| `intensity` | nein | Freitext, z. B. `"RPE 5"`; nur in der Tagesansicht |
| `description` | nein | Freitext; nur in der Tagesansicht |
| `recovery.score` | nein | Erholung 0–100 |
| `recovery.sleepMinutes` | nein | Schlaf in Minuten |
| `recovery.hrv` | nein | HRV in ms |
| `recovery.restingHr` | nein | Ruhepuls |

- `display/js/adapter.js` ist die einzige Stelle, die dieses Format kennt.
- Fehlt ein optionales Feld, lässt die Anzeige den Teil weg. Der heutige Serverstand (nur `type` und `title`) liegt als `fixtures/data.minimal.json` bei.
- Ein Tag ohne Einheiten ist ein Ruhetag.
- Das Format hat keine Daten: Die Woche gilt als wiederkehrende Vorlage, die Datumszahlen berechnet der Pi.
- Die Wochensumme in der Kopfzeile ist die Summe aller `duration`.

## Mit 1 GB RAM auskommen

- Kein Framework im Display; ein Render pro Minute (Uhr) und pro Sync.
- Schrift (ein Variable-woff2, 35 KB) und Icons (SVG-Sprite) liegen lokal, kein CDN.
- Farben als CSS-Variablen; Hell/Dunkel ist ein Attribut auf `<html>`.
- Keine Animationen außer der Slideshow-Überblendung (Opacity).
- Chromium-Kiosk mit einem Tab; falls zu schwer, WPE/Cog ohne Codeänderung.
- Logs ins RAM, Cache atomar schreiben, später Read-only-Root.

## Einrichtung

1. Ohne gespeichertes WLAN öffnet der Pi den Hotspot (NetworkManager); der QR-Code enthält SSID und Passwort.
2. dnsmasq leitet alle DNS-Anfragen auf den Pi, das Handy öffnet das Portal von selbst.
3. Im Portal: Heim-WLAN wählen, Passwort, Server-URL, API-Key.
4. Hotspot zu, verbinden, Server testen. Scheitert etwas, kommt der Hotspot nach 30 s mit Fehlermeldung zurück.
5. Im Heimnetz zeigt das Display einen QR-Code zum Admin-Bereich mit Einmal-Code. Dort am PC oder Handy das Admin-Passwort festlegen; man ist sofort angemeldet, die Einrichtung ist abgeschlossen.

„WLAN ändern“ im Admin-Bereich startet wieder bei Schritt 1, behält aber das Passwort; Schritt 5 entfällt dann. Die Werkseinstellung löscht auch das Passwort.

Der 3B+ hat ein Funkmodul; Hotspot und Heim-WLAN laufen deshalb nacheinander, nicht gleichzeitig.

- Screens 3A (Hotspot + WLAN-QR), 3B (Portal + QR zur Portal-Adresse), Admin-Schritt (QR mit Einmal-Code), 3C (fertig, 4 s), dazu „Verbinde …“ und „Das hat nicht geklappt“ während der 30 s.
- Den Einmal-Code bekommt nur das Display (Anfragen von localhost); andere Geräte im Netz sehen ihn weder über `/events` noch als QR-Code.
- Abweichung von der Vorlage: 3B verweist nicht auf eine externe Website mit Account, sondern auf das Portal auf dem Pi.
- QR-Codes erzeugt der Daemon selbst (`daemon/qr.js`, ohne Abhängigkeiten).
- Prüfadressen von Android, iOS und Windows (`/generate_204`, `/hotspot-detect.html` …) und auf dem Pi jeder fremde Host leiten während der Einrichtung auf das Portal um.
- Offen für den Pi: Hotspot, WLAN-Suche und Verbinden per `nmcli` im Pi-Adapter; Portal auf Port 80 (Weiterleitung auf 8080); Hotspot-Adresse `10.42.0.1`.

## Ruhe und Slideshow

- Fristen (Start 5 und 30 Minuten) im Admin-Panel einstellbar.
- Der erste Tipp im Zustand AUS weckt nur.
- Ohne Bilder geht das Display nach der ersten Frist direkt aus.
- Der PIR reicht etwa 2 m, sieht nicht durch Glas und erkennt keine stillstehende Person; er braucht eine Öffnung in der Front.
- Bilder werden im Browser des Admin-Panels auf 1024 × 600 verkleinert, bevor sie hochgeladen werden.
- Im Display nur zwei `<img>`-Elemente; das nächste Bild wird vorab dekodiert.
- Bilder liegen auf der Daten-Partition, Obergrenze 200.

## Update per Knopf

1. Der Knopf startet eine eigene systemd-Unit.
2. Commit merken, `git fetch`, auf das neueste Release-Tag wechseln.
3. `scripts/update.sh` ausführen, Daemon neu starten.
4. Antwortet `/health` nicht binnen 30 s, zurück auf den gemerkten Commit.

Abhängigkeiten liegen fertig im Release-Branch; auf dem Pi läuft kein `npm install`.

## Debug-Modus

`FRAME_ENV=dev` lädt den Mock-Adapter statt nmcli, GPIO und Backlight.

- Dev-Leiste unter `/debug`: Zustand erzwingen, Bewegung auslösen, Uhr verstellen, Theme, Testpläne.
- Fehler simulieren: falsches WLAN-Passwort, kein Internet, Server lehnt Key ab.
- Fixtures statt echter Abrufe, damit die Entwicklung offline läuft.
- `?theme=dark|light`, `?now=2026-09-09T18:42` und `?day=0…6` am Display haben Vorrang vor der Dev-Leiste.
- Auf dem Pi: Deploy-Skript, Remote-Debugging über SSH-Tunnel, Overlay mit RAM und Temperatur.

## Phasen

- [x] 1. Wochenraster 2A/2B aus Fixtures, Tokens, Schrift und Icons lokal
- [ ] 2. Auf dem Pi messen (RAM, Startzeit), Browser festlegen, PIR und Backlight testen (verschoben, bis der Pi da ist)
- [x] 3. Daemon: Zustandsautomaten, SSE, Mock-Adapter, Dev-Leiste
- [ ] 4. Touch: Tagesansicht mit Rücksprung (am PC fertig; Touch am Pi steht aus)
- [ ] 5. Einrichtungs-Screens und Portal gegen den Mock, danach echter Hotspot (gegen den Mock fertig; echter Hotspot braucht den Pi)
- [ ] 6. Sync mit Server und Open-Meteo, Offline-Cache (fertig mit Fixtures, Test-Server und echtem Open-Meteo; Test gegen den echten Server steht aus)
- [ ] 7. Admin-Login, Panel, Slideshow-Upload, Update-Knopf (alles außer Update-Knopf fertig; der braucht ein Git-Remote mit Release-Tags)
- [ ] 8. Kiosk-Autostart, Logs ins RAM, Read-only-Root

## Starten

```
npm run dev
```

Danach `http://localhost:8080` (Display) oder `http://localhost:8080/debug` (Dev-Leiste) öffnen.
