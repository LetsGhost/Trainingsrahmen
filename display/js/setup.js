// Einrichtungs-Screens (Einrichtung.dc.html, 3A–3C): ein Schritt, eine Anweisung, daneben der QR-Code.
// Der QR-Code enthält alles Nötige (WLAN-Passwort bzw. Portal-Adresse), damit auf dem Screen nur eine Zeile steht.
import { esc, icon } from "./util.js";

const STEPS = ["Hotspot", "WLAN", "Admin"];

function renderSteps(current) {
  return `
    <div class="su-steps">${STEPS.map((label, i) => `
      <div class="su-step${i <= current ? " on" : ""}">
        <div class="su-step-bar"></div>
        <div class="su-step-text"><span class="su-step-n">0${i + 1}</span><span class="su-step-label">${label}</span></div>
      </div>`).join("")}
    </div>`;
}

const qrImage = src => `<div class="su-qr"><img src="${src}" alt=""></div>`;

function renderScreen({ step, title, value, note, side = "" }) {
  return `
    <section class="setup">
      ${renderSteps(step)}
      <div class="su-body">
        <div class="su-text">
          <div class="su-kicker">SCHRITT ${step + 1} VON 3</div>
          <div class="su-title">${esc(title)}</div>
          ${value ? `<div class="su-value">${esc(value)}</div>` : ""}
          ${note ? `<div class="su-note">${esc(note)}</div>` : ""}
        </div>
        ${side}
      </div>
    </section>`;
}

// f: Momentaufnahme des Daemons. done: 3C nach erfolgreicher Einrichtung, bevor der Plan erscheint.
export function renderSetup(f, done) {
  if (done) {
    return renderScreen({ step: 2, title: "Alles bereit.", value: "Plan wird geladen …", side: `<div class="su-done">${icon("circle-check")}</div>` });
  }
  if (f.connecting) {
    return renderScreen({ step: 1, title: `Verbinde mit ${f.connectingTo ?? "dem WLAN"} …`, value: "Das dauert ein paar Sekunden." });
  }
  // Nach einem Fehler ist der Hotspot 30 s lang zu, dann öffnet er wieder (3A mit Hinweis).
  if (f.error && !f.hotspot) {
    return renderScreen({ step: 1, title: "Das hat nicht geklappt.", value: f.error.message, note: "Das WLAN des Rahmens ist gleich wieder da." });
  }
  if (f.setup === "SETUP_ADMIN") {
    const url = f.adminUrl?.replace(/^https?:\/\//, "");
    return renderScreen({
      step: 2,
      title: "Öffne den Admin-Bereich und lege ein Passwort fest",
      value: url,
      note: f.adminCode ? `Ohne QR-Code: Adresse öffnen und Code ${f.adminCode} eingeben.` : null,
      side: f.adminCode ? qrImage(`/api/setup/qr/admin.svg?c=${f.adminCode}`) : ""
    });
  }
  if (f.setup === "SETUP_ACCOUNT") {
    return renderScreen({
      step: 1,
      // Hinter „API-“ steht ein Wortverbinder (U+2060); er verhindert den Umbruch am Bindestrich („API-“ / „Key“).
      title: "Trage im Portal dein WLAN und den API-⁠Key ein",
      value: f.portalUrl ? f.portalUrl.replace(/^https?:\/\//, "") : null,
      note: "Hat sich das Portal nicht geöffnet? QR-Code scannen.",
      side: qrImage("/api/setup/qr/portal.svg")
    });
  }
  return renderScreen({
    step: 0,
    title: "Verbinde dein Handy mit dem WLAN",
    value: f.hotspot?.ssid,
    note: f.error ? `Letzter Versuch: ${f.error.message}` : null,
    // Passwort in der URL: Sonst zeigt Chromium nach einem neuen Hotspot (gleiche SSID) das alte Bild weiter.
    side: f.hotspot ? qrImage(`/api/setup/qr/wifi.svg?ssid=${encodeURIComponent(f.hotspot.ssid)}&p=${encodeURIComponent(f.hotspot.password)}`) : ""
  });
}
