# Trainingsrahmen – Stand und Weg zur v1

Stand: 12.11.2026 · Grundlage: Commit `a915260` plus die noch nicht committeten Änderungen (Einstellungen am Rahmen) · `npm test`: 20/20 grün

## Kurzfassung

**Software am PC: etwa 85–90 % fertig. Auf dem Pi läuft ein älterer Stand sauber, Hotspot und Einrichtung eingeschlossen. Der aktuelle Stand ist dort noch ungetestet.**

> Nachtrag 12.11.2026: Laut Nutzer läuft ein älterer Stand bereits sauber auf dem Pi; Hotspot und Einrichtung haben funktioniert. Die Hardware-Risiken unten gelten daher vor allem für das, was seitdem dazugekommen ist: Einstellungen am Rahmen (Helligkeit/Backlight, Halten-Knopf), Garmin, AthletePT und das neue Admin-Panel.

Alle Funktionen aus `PLAN.md` sind gebaut und laufen gegen den Mock-Adapter. Darunter:

- Wochenraster, Tagesansicht und Erholung
- Einrichtung mit Hotspot und Portal
- Admin-Panel mit Slideshow und Update-Knopf
- Garmin, AthletePT und Wetter

Der Code ist sauber. XSS habe ich nicht gefunden, es gibt keine Shell-Injection, und statische Dateien sind gegen Pfad-Tricks abgesichert.

Bis zur v1 fehlen vor allem drei Dinge:

1. **Den aktuellen Stand auf dem Pi testen.** Hotspot und Grundbetrieb liefen dort mit einem älteren Stand. Neu zu prüfen sind Backlight-Stufen, der Halten-Knopf am Touch und Update/Rollback.
2. **Eine Handvoll echter Bugs**, die meisten in unter einer Stunde behoben (siehe unten).
3. **Die Einstellungen am Rahmen committen**, mit Tests.

Grobe Schätzung bis zur v1: **etwa 1 Tag Bugfixes und Tests am PC**, dazu **etwa 1–2 Tage Regressionstest am Pi**.

## Stand je Bereich

| Bereich | Stand | Offen |
|---|---|---|
| Wochenraster 2A/2B | ✅ fertig | – |
| Tagesansicht 1B | ✅ am PC | Touch am Pi |
| Erholungs-Ansicht | ✅ | Garmin-Daten können von gestern sein (Bug D2) |
| Einrichtung 3A–3C, Portal, Admin-Schritt | ✅ auf dem Pi (älterer Stand) | mit dem aktuellen Stand erneut testen |
| Einstellungen am Rahmen (WIP) | 🟡 Daemon und Display verdrahtet | Halten-Knopf am Touch unsicher, keine Tests, nicht committet |
| Slideshow | ✅ | kleiner Race-Bug |
| Admin-Panel | ✅ | Helligkeit wird überschrieben, keine Tests für Login und Sitzung |
| Sync (Sport-Analytics, AthletePT, Garmin, Wetter) | ✅ mit Fixtures | Test gegen den echten Sport-Analytics-Server (Phase 6) |
| Update per Knopf | ✅ Daemon | Rollback kann lokale Änderungen löschen, am Pi ungeprüft |
| Pi-Installation (`setup-pi.sh`, Units, Kiosk, Plymouth) | ✅ auf dem Pi (älterer Stand) | mit dem aktuellen Stand erneut testen |
| Logs ins RAM, Read-only-Root, RAM-/Temperatur-Overlay | ❌ offen | – |
| Messungen (RAM, Startzeit, Browser) | ❌ offen | Tabelle in `ENTWICKLUNG.md` ist leer |

Die Designvorlagen (`*.dc.html`) liegen nicht im Repo, deshalb konnte niemand die Umsetzung mit der Vorlage vergleichen.

## Gefundene Fehler

> **Behoben am 12.11.2026:** B1–B6, D2 (Erholung von gestern, mit Test in `daemon/sync.test.js`), `Restart=on-failure` in der Hotspot-Unit, Zeitlimit beim Update-Polling im Admin. Was davon am Pi geprüft werden muss, steht in `TESTPLAN-PI.md`.

### Muss vor v1 (klein, am PC behebbar)

| # | Wo | Problem | Aufwand |
|---|---|---|---|
| B1 | `daemon/server.js:415-420` | `listen()` hat keinen `error`-Handler. Kann der Daemon Port 80 oder 8080 nicht binden, stürzt er ab und startet in einer Schleife neu; der Kiosk bleibt leer. | 15 min |
| B2 | `scripts/self-update.sh:51,75` | `git pull --ff-only` scheitert nur, wenn eine lokal geänderte Datei auch im Update vorkommt. Bei einem Rollback löscht `git reset --hard` dann Änderungen, die per `deploy.sh` auf den Pi kamen. Die Doku verspricht das Gegenteil. Abhilfe: vor dem Pull mit `git status --porcelain` abbrechen. | 30 min |
| B3 | `daemon/system/pi.js:211-227` | Nach einem Daemon-Neustart ohne erreichbares WLAN löscht `check()` die NetworkManager-Verbindung alle 30 s und legt sie neu an. Das schreibt jedes Mal auf die SD-Karte, und die Autoconnect-Verbindung fehlt kurz. | 30–60 min |
| B4 | `display/js/display.js:326-350` | Halten-Knopf (Neustart, Herunterfahren): Ein zweiter Finger überschreibt `holdTimer`, der erste Timer feuert trotzdem. Rutscht der Finger vom Knopf, bricht das Halten nicht ab. Es fehlen `touch-action: none` und ein Schutz gegen das Kontextmenü; Chromium kann bei 2 s Long-Press `pointercancel` oder ein Kontextmenü auslösen. | 30 min, danach am Pi testen |
| B5 | `admin/admin.js:316,322` | Das Admin-Panel schickt `{...state.settings.display}` mit dem Stand vom Laden mit. Eine am Rahmen geänderte Helligkeit wird beim nächsten Klick im Admin zurückgesetzt. Nur die geänderten Felder senden. | 15 min |
| B6 | `daemon/updater.js:89,95` | `spawn` hat keinen `error`-Handler. Fehlt `systemctl`, stürzt der Daemon ab; `update.json` bleibt 3 min auf „running“. | 15 min |

### Sollte vor v1

- **D2 Erholung von gestern** (`daemon/sync.js:80`, `daemon/garmin.js:107`): Bleibt der Rahmen über Mitternacht offline, zeigt er Schlaf und HRV vom Vortag als heutige Werte. Das Datum des Caches wird nicht geprüft.
- **Hotspot-Unit ohne `Restart=on-failure`**: Stirbt hostapd, merkt der Daemon das nicht (`pi.js:185`).
- **WLAN-Stromsparen** für brcmfmac nicht abgeschaltet (`wifi.powersave=2`): auf dem Pi ein bekannter Grund für Verbindungsabbrüche.
- **Logs ins RAM** (`Storage=volatile` in journald): 1 h, schont die SD-Karte.
- **Admin-Update-Polling ohne Zeitlimit** (`admin/admin.js:663-678`): Kommt kein Ergebnis, steht „Rahmen startet neu …“ für immer da.

### Kann nach v1

- Slideshow-Race (`display/js/slideshow.js:27-43`): Auf Stop und schnellen Neustart folgen zwei `next()`-Ketten; eine gelöschte Datei zeigt ein leeres Bild.
- `readJson` bei mehr als 64 KB: Das Promise bleibt hängen (`server.js:163`).
- `FRAME_ACTIONS["constructor"]`: `Object.hasOwn` verwenden.
- Kaputtes JSON auf `/api/frame/*` gibt 409 statt 400.
- Portal: Bei einer Fehlerantwort ohne JSON steht fälschlich „Der Rahmen antwortet nicht“ (`portal/portal.js:150`). Die WPA-Mindestlänge wird nicht im Browser geprüft.
- `cage -d` in `scripts/kiosk.sh:147` müsste `-D` heißen (Debug-Log).
- `/health` antwortet immer mit `ok:true`.
- Änderungen an Units oder polkit-Regeln kommen per Update nie auf den Pi (`update.sh` ruft `install-services.sh` nicht auf).

## Sicherheit und Datenschutz

- **Gut:** scrypt, Sitzung `HttpOnly` und `SameSite=Strict`, Einmal-Code nur über localhost, `/api/frame/*` prüft `remoteAddress`, überall `execFile` mit Argumentlisten, Slides-Dateinamen per Regex.
- **Bewusst offen, aber zu entscheiden:**
  - `/api/plan` und `/events` liefern HRV, Schlaf, Ruhepuls, SSID und IP an jedes Gerät im Heimnetz, ohne Login.
  - Das Admin-Passwort geht ohne TLS über das Heimnetz.
  - Die Login-Sperre ist global: Ein Gerät im Netz kann den Admin dauerhaft aussperren.
- **Rechte:** Der Daemon läuft als `admin`, und dieser User hat bei Imager-Installationen meist sudo ohne Passwort. Eine Lücke im Daemon bedeutet dann Root-Rechte. Die polkit-Regel erlaubt außerdem alle NetworkManager-Aktionen. Für v1 hinnehmbar, danach einen eigenen User ohne sudo einrichten.
- Das WLAN-Passwort steht im Klartext in `config.json` und kurz in der Prozessliste von nmcli.

## Testabdeckung

Getestet sind nur `athletept`, `garmin`, `state` (Prüfung und Hotspot-Neuversuch), ein Server-Smoke-Test und `settings` (`bars`, Stepper).

**Ohne Tests, nach Risiko geordnet:**

1. `daemon/admin.js`: Login, Sitzung, Einmal-Code, Sperre. Das größte Sicherheitsrisiko ohne Test.
2. `server.js`-Routen: localhost-Prüfung für `/api/frame/*` und den Admin-QR.
3. `daemon/qr.js`: Ein falscher QR-Code macht die Einrichtung kaputt.
4. `sync.js` (Zusammenführen, Cache), `updater.js`, `slides.js`.
5. Die Parser in `pi.js` (`splitTerse`, WLAN-Scan); nicht exportiert.

Außerdem: `package.json` ohne `"type": "module"` erzeugt beim Testlauf eine Warnung für `settings.test.js`.

## Hardware-Risiken (nur am Pi zu klären)

Hotspot und Captive Portal haben mit einem älteren Stand bereits funktioniert. Offen ist noch:

1. **Hotspot-Robustheit:** Startet die Unit hostapd nach einem Absturz neu (`Restart=`)? Hält das WLAN mit Stromsparen über Tage durch?
2. **Display-Overlay:** `vc4-kms-dsi-7inch` passt nur zu Waveshare-Revisionen, die das offizielle Display nachbilden. Neuere brauchen `vc4-kms-dsi-waveshare-panel,…`. Davon hängen Backlight-Pfad und Helligkeitsstufen ab (`pi.js:83,260`).
3. **Chromium-Paketname** (`chromium` oder `chromium-browser`) im Selbsttest von `setup-pi.sh`.
4. **PIR über gpiomon:** Ausgabe in der Pipe eventuell gepuffert; Abhilfe wäre `stdbuf -oL`.
5. **RAM und Startzeit** mit Chromium auf 1 GB; falls nötig auf WPE/Cog wechseln.

## Fahrplan zur v1

**Am PC (ca. 1 Tag):**

1. B1–B6 beheben, dazu D2 und `Restart=` in der Hotspot-Unit.
2. Tests für `admin.js` (Login, Einmal-Code, Sperre) und die localhost-Prüfung von `/api/frame`.
3. Die Einstellungen am Rahmen committen.
4. Test gegen den echten Sport-Analytics-Server (Phase 6).

**Am Pi (ca. 1–2 Tage, Regressionstest des aktuellen Stands):**

5. Den aktuellen Stand per Update-Knopf oder `deploy.sh` aufspielen; dabei Update und Rollback mittesten.
6. Kurzer Gegencheck von Hotspot und Portal („WLAN ändern“).
7. Touch: Tag antippen, Aufwecken, Halten-Knopf (Phase 4).
8. Messen: RAM, Startzeit, Temperatur, Backlight-Stufen, PIR; danach den Browser festlegen (0,5 Tag).
9. Rollback gezielt auslösen, z. B. mit einem absichtlich kaputten `update.sh`.
10. Logs ins RAM, WLAN-Stromsparen aus; im Betrieb den Stecker ziehen und prüfen, ob `data/` heil bleibt.

**Nach v1:** Read-only-Root (Overlay-FS, `data/` auf eigener Partition), RAM-/Temperatur-Overlay, eigener User ohne sudo, Update-Pfad für Units, Punkte aus „Kann nach v1“.

## Hinweis zur Dev-Umgebung

Auf den Ports 8080 und 8091 liefen beim Review ältere Daemon-Prozesse. Sie kennen `/api/frame/*` noch nicht, deshalb wirkt der Einstellungs-Screen dort kaputt. Vor dem Testen `npm run dev` neu starten.
