// Admin-Bereich: erstes Passwort (mit Einmal-Code vom Display), Login und Panel.
// Das Panel wird einmal aufgebaut; danach zeichnet jeder Bereich nur sich selbst neu, damit Eingaben erhalten bleiben.
const app = document.getElementById("app");
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SLIDE_W = 800, SLIDE_H = 480;
const STATUS_REFRESH_MS = 10000;
const UPDATE_POLL_MS = 2000;
const SETUP_LABELS = {
  READY: "Online", OFFLINE: "Offline", SETUP_ADMIN: "Einrichtung", SETUP_HOTSPOT: "Hotspot", SETUP_ACCOUNT: "Hotspot"
};
const REST_LABELS = { AKTIV: "Display aktiv", SLIDESHOW: "Slideshow", AUS: "Display aus" };

const state = { tab: "home", open: null, settings: null, status: null, slides: [], maxSlides: 200, geo: [] };
let statusTimer = null;

async function api(path, { method = "GET", body, blob } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (blob) headers["Content-Type"] = blob.type;
  let res;
  try {
    res = await fetch(`/api/admin/${path}`, { method, headers, body: blob ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    return { ok: false, error: "Der Rahmen antwortet nicht." };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "login") {
    clearInterval(statusTimer);
    start();
    return { ok: false, error: "Sitzung abgelaufen" };
  }
  return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Fehler ${res.status}` };
}

function setMsg(id, text, ok = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text ?? "";
  el.className = `msg ${ok ? "ok" : "error"}`;
}

// --- Login und erstes Passwort (1D) ---

function authLayout(form) {
  return `
    <div class="auth">
      <div class="auth-box">
        <div class="auth-intro">
          <div class="kicker">TRAININGSRAHMEN</div>
          <div>
            <div class="auth-title">Admin für<br>den Rahmen</div>
            <p class="auth-text">Server, Ort, Anzeige, Slideshow und Systemstatus. Erreichbar nur im Heimnetz.</p>
          </div>
          <div></div>
        </div>
        <div class="auth-divider"></div>
        <form class="auth-form" id="auth" novalidate>${form}</form>
      </div>
    </div>`;
}

const passwordField = (id, label, autocomplete) => `
  <div class="field">
    <label class="label" for="${id}">${label}</label>
    <input type="password" id="${id}" autocomplete="${autocomplete}">
  </div>`;

function showSetup() {
  const code = new URLSearchParams(location.search).get("code") ?? "";
  app.innerHTML = authLayout(`
    <div class="field">
      <h1>Passwort festlegen</h1>
      <div class="muted">Letzter Schritt der Einrichtung. Mit diesem Passwort meldest du dich künftig hier an.</div>
    </div>
    <div class="field"${code ? " hidden" : ""}>
      <label class="label" for="code">CODE VOM DISPLAY</label>
      <input type="text" id="code" value="${esc(code)}" autocapitalize="characters" autocomplete="off">
    </div>
    ${passwordField("password", "PASSWORT (MIN. 8 ZEICHEN)", "new-password")}
    ${passwordField("repeat", "PASSWORT WIEDERHOLEN", "new-password")}
    <button class="primary" id="submit"><span>Festlegen & anmelden</span><span>→</span></button>
    <div class="msg" id="auth-msg"></div>`);
  $("#auth").addEventListener("submit", async e => {
    e.preventDefault();
    if ($("#password").value !== $("#repeat").value) return setMsg("auth-msg", "Die Passwörter stimmen nicht überein.");
    $("#submit").disabled = true;
    const r = await api("setup", { method: "POST", body: { code: $("#code").value.trim(), password: $("#password").value } });
    $("#submit").disabled = false;
    if (!r.ok) return setMsg("auth-msg", r.error);
    history.replaceState(null, "", "/admin");
    showPanel();
  });
}

function showLogin() {
  app.innerHTML = authLayout(`
    <div class="field">
      <h1>Anmelden</h1>
      <div class="muted">Admin-Passwort aus der Einrichtung.</div>
    </div>
    <div class="field">
      <label class="label" for="user">BENUTZER</label>
      <input type="text" id="user" value="admin" readonly>
    </div>
    ${passwordField("password", "PASSWORT", "current-password")}
    <button class="primary" id="submit"><span>Anmelden</span><span>→</span></button>
    <div class="msg" id="auth-msg"></div>
    <div class="muted" style="font-size:12px">Sitzung bleibt 12 h aktiv</div>`);
  $("#password").focus();
  $("#auth").addEventListener("submit", async e => {
    e.preventDefault();
    $("#submit").disabled = true;
    const r = await api("login", { method: "POST", body: { password: $("#password").value } });
    $("#submit").disabled = false;
    if (!r.ok) return setMsg("auth-msg", r.error);
    showPanel();
  });
}

function showUnavailable() {
  app.innerHTML = authLayout(`
    <div class="field">
      <h1>Noch nicht eingerichtet</h1>
      <div class="muted">Folge den Schritten auf dem Display. Am Ende zeigt es einen QR-Code, der hierher führt.</div>
    </div>`);
}

// --- Panel (nach Admin.dc.html) ---

// Lucide-Icons (ISC), inline, damit der Admin ohne Internet funktioniert.
const ICONS = {
  "layout-grid": '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  "key-round": '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  "alert-triangle": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>'
};
const icon = (name, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const TABS = [
  { id: "home", label: "Übersicht", icon: "layout-grid", sub: "Zustand des Rahmens auf einen Blick." },
  { id: "display", label: "Anzeige", icon: "monitor", sub: "Was der Rahmen zeigt und wie." },
  { id: "services", label: "Dienste", icon: "key-round", sub: "Zugänge für Trainingsplan, AthletePT und Garmin." },
  { id: "slides", label: "Slideshow", icon: "image", sub: "Bilder, die der Rahmen in Ruhe zeigt." },
  { id: "system", label: "System", icon: "cpu", sub: "Technische Werte des Raspberry Pi." }
];

async function showPanel() {
  app.innerHTML = `
    <div class="shell">
      <header class="top">
        <div class="brand">TRAININGSRAHMEN <span>ADMIN</span></div>
        <div class="top-right">
          <div class="state" id="state"></div>
          <button class="secondary icon-btn" id="logout">${icon("log-out", 15)}<span>Abmelden</span></button>
        </div>
      </header>
      <div class="panel">
        <nav class="nav">${TABS.map(t =>
          `<button class="nav-item" data-tab="${t.id}">${icon(t.icon, 17)}<span>${t.label}</span></button>`).join("")}
        </nav>
        <main class="main">
          <div class="page-head">
            <div class="page-title" id="title"></div>
            <div class="page-sub" id="subtitle"></div>
          </div>
          <div id="main"></div>
        </main>
      </div>
    </div>`;
  document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    renderMain();
  }));
  $("#logout").addEventListener("click", async () => {
    await api("logout", { method: "POST", body: {} });
    clearInterval(statusTimer);
    start();
  });
  $("#main").addEventListener("click", e => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action) ACTIONS[action]();
  });

  const [settings, slides] = await Promise.all([api("settings"), api("slides")]);
  if (!settings.ok) return;
  state.settings = settings.data;
  if (slides.ok) Object.assign(state, { slides: slides.data.slides, maxSlides: slides.data.max });
  renderMain();
  refreshStatus();
  clearInterval(statusTimer);
  statusTimer = setInterval(refreshStatus, STATUS_REFRESH_MS);
}

function renderMain() {
  const tab = TABS.find(t => t.id === state.tab) ?? TABS[0];
  document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === tab.id));
  $("#title").textContent = tab.label;
  $("#subtitle").textContent = tab.sub;
  ({ home: renderHome, display: renderDisplay, services: renderServices, slides: renderSlides, system: renderSystem })[tab.id]();
  renderStatus();
}

// Einstellungen speichern; nach Erfolg kommt die neue Fassung vom Daemon zurück.
async function save(part, msgId, okText = "Gespeichert") {
  setMsg(msgId, "Speichere …", true);
  const r = await api("settings", { method: "POST", body: part });
  if (!r.ok) return setMsg(msgId, r.error), false;
  state.settings = r.data;
  setMsg(msgId, okText, true);
  return true;
}

// --- Übersicht ---

function renderHome() {
  $("#main").innerHTML = `
    <div class="facts" id="facts"></div>
    <div id="issue"></div>
    <div class="row wrap">
      <button class="primary wide" data-action="sync"><span>Jetzt neu laden</span>${icon("refresh-cw")}</button>
      <button class="secondary wide" data-action="reboot"><span>Rahmen neu starten</span>${icon("power")}</button>
    </div>
    <div class="msg" id="action-msg"></div>`;
}

// --- Anzeige ---

function toggle(name, options, current) {
  return `<div class="toggle" data-toggle="${name}">${options.map(([value, label]) =>
    `<button type="button" data-value="${value}" class="${String(current) === String(value) ? "on" : ""}">${label}</button>`).join("")}</div>`;
}

const switchRow = (key, name, hint, on) => `
  <button type="button" class="switch-row" data-switch="${key}" aria-pressed="${on}">
    <span><span class="setting-name">${name}</span><span class="setting-hint">${hint}</span></span>
    <span class="switch"><span></span></span>
  </button>`;

function renderDisplay() {
  const s = state.settings;
  $("#main").innerHTML = `
    <div class="list">
      <div class="setting">
        <div>
          <div class="setting-name">Erscheinungsbild</div>
          <div class="setting-hint">Automatisch folgt dem Nachtfenster 22:00 – 06:00</div>
        </div>
        ${toggle("theme", [["light", "HELL"], ["dark", "DUNKEL"], ["auto", "AUTOMATISCH"]], s.display.theme)}
      </div>
      <form class="setting stack" id="geo-form" novalidate>
        <div class="setting-line">
          <div>
            <div class="setting-name">Ort</div>
            <div class="setting-hint">Für das Wetter · aktuell ${esc(s.location.name)}</div>
          </div>
          <div class="row"><input type="text" id="geo" placeholder="Ort suchen"><button class="secondary">Suchen</button></div>
        </div>
        <div class="results" id="geo-results"></div>
        <div class="msg" id="geo-msg"></div>
      </form>
    </div>

    <div class="kicker-row">AUF DEM DISPLAY ZEIGEN</div>
    <div class="list soft">
      ${switchRow("showWeather", "Wetter", "Kopfzeile und Tagesansicht", s.display.showWeather)}
      ${switchRow("showRecovery", "Erholung & Schlaf", "Leiste unten", s.display.showRecovery)}
    </div>
    <div class="msg" id="display-msg"></div>

    <div class="kicker-row">RUHE</div>
    <form class="list" id="rest-form" novalidate>
      <div class="setting">
        <div class="setting-name">Slideshow nach (Minuten)</div>
        <input type="number" class="num" id="slideshowAfter" min="1" max="120" value="${s.deadlines.slideshowAfterMin}">
      </div>
      <div class="setting">
        <div class="setting-name">Display aus nach (Minuten)</div>
        <input type="number" class="num" id="offAfter" min="2" max="600" value="${s.deadlines.offAfterMin}">
      </div>
      <div class="setting-hint pad">Gezählt ab der letzten Bewegung oder Berührung. Ohne Bilder geht das Display schon nach der ersten Frist aus.</div>
      <div class="row"><button class="secondary">Speichern</button><div class="msg" id="rest-msg"></div></div>
    </form>`;

  $("#geo-form").addEventListener("submit", async e => {
    e.preventDefault();
    setMsg("geo-msg", "Suche …", true);
    const r = await api(`geocode?q=${encodeURIComponent($("#geo").value)}`);
    if (!r.ok) return setMsg("geo-msg", r.error);
    state.geo = r.data;
    setMsg("geo-msg", r.data.length ? "" : "Nichts gefunden", true);
    $("#geo-results").innerHTML = r.data.map((g, i) =>
      `<button type="button" class="result" data-geo="${i}">${esc(g.name)} <span>${esc(g.detail)}</span></button>`).join("");
  });
  $("#geo-results").addEventListener("click", async e => {
    const g = state.geo[e.target.closest("[data-geo]")?.dataset.geo];
    if (!g) return;
    if (await save({ location: { name: g.name, lat: g.lat, lon: g.lon } }, "geo-msg")) {
      renderDisplay();
      setMsg("geo-msg", `Ort: ${g.name}`, true);
    }
  });

  document.querySelectorAll("[data-toggle]").forEach(t => t.addEventListener("click", async e => {
    const value = e.target.dataset.value;
    if (value === undefined) return;
    if (await save({ display: { ...state.settings.display, theme: value } }, "display-msg")) {
      t.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.target));
    }
  }));
  document.querySelectorAll("[data-switch]").forEach(b => b.addEventListener("click", async () => {
    const key = b.dataset.switch;
    const on = !state.settings.display[key];
    if (await save({ display: { ...state.settings.display, [key]: on } }, "display-msg")) b.setAttribute("aria-pressed", on);
  }));

  $("#rest-form").addEventListener("submit", e => {
    e.preventDefault();
    save({ deadlines: { slideshowAfterMin: Number($("#slideshowAfter").value), offAfterMin: Number($("#offAfter").value) } }, "rest-msg");
  });
}

// --- Dienste ---

// Eine Zeile je Zugang; „Ändern“ klappt das Formular darunter auf.
function serviceRow({ id, name, active, missing, value, form }) {
  const open = state.open === id;
  return `
    <div class="service">
      <div class="service-line">
        <div class="service-text">
          <div class="row">
            <span class="setting-name">${name}</span>
            <span class="badge ${!active && missing ? "bad" : ""}">${active ? "AKTIV" : missing ? "FEHLT" : "OPTIONAL"}</span>
          </div>
          <div class="mono">${esc(value)}</div>
        </div>
        <button type="button" class="secondary" data-open="${id}">${open ? "Schließen" : active ? "Ändern" : "Hinzufügen"}</button>
      </div>
      <div class="service-form"${open ? "" : " hidden"}>${form}</div>
    </div>`;
}

const keyField = (id, label, masked) => `
  <div class="field">
    <label class="label" for="${id}">${label}</label>
    <input type="text" id="${id}" placeholder="${esc(masked)} · leer lassen zum Behalten" autocomplete="off" spellcheck="false">
  </div>`;

function renderServices() {
  const s = state.settings;
  $("#main").innerHTML = `<div class="list">
    ${serviceRow({ id: "server", name: "Trainingsplan", active: Boolean(s.server.url), missing: true, value: s.server.url || "nicht gesetzt", form: `
      <form class="block" id="server-form" novalidate>
        <div class="grid2">
          <div class="field">
            <label class="label" for="url">SERVER-URL</label>
            <input type="url" id="url" value="${esc(s.server.url)}" placeholder="https://…">
          </div>
          ${keyField("apiKey", "API-KEY", s.server.apiKey)}
        </div>
        <div class="row"><button class="secondary">Prüfen & speichern</button><div class="msg" id="server-msg"></div></div>
      </form>` })}
    ${serviceRow({ id: "athletept", name: "AthletePT", active: Boolean(s.athletept.url), value: s.athletept.url || "nicht verbunden", form: `
      <form class="block" id="athletept-form" novalidate>
        <div class="setting-hint">Die Trainings aus AthletePT erscheinen zusätzlich im Plan. URL leeren und speichern entfernt die Quelle.</div>
        <div class="grid2">
          <div class="field">
            <label class="label" for="athleteptUrl">ATHLETEPT-URL</label>
            <input type="url" id="athleteptUrl" value="${esc(s.athletept.url)}" placeholder="https://…">
          </div>
          ${keyField("athleteptKey", "API-KEY", s.athletept.apiKey)}
        </div>
        <div class="row"><button class="secondary">Prüfen & speichern</button><div class="msg" id="athletept-msg"></div></div>
      </form>` })}
    ${serviceRow({ id: "garmin", name: "Garmin", active: s.garmin.active, value: s.garmin.active ? s.garmin.apiKey : "nicht verbunden", form: `
      <form class="block" id="garmin-form" novalidate>
        <div class="setting-hint">Schlaf, HRV, Ruhepuls und Body Battery von Garmin gehen in der Erholungsleiste vor; Aktivitäten der Woche haken passende Einheiten im Plan ab. Key anlegen unter Garmin Connect → Einstellungen → Personal API; er läuft je nach Wahl nach 30 Tagen bis einem Jahr ab.</div>
        ${keyField("garminKey", "PERSONAL-API-KEY", s.garmin.apiKey)}
        <div class="row">
          <button class="secondary">Prüfen & speichern</button>
          ${s.garmin.active ? `<button type="button" class="secondary" id="garmin-remove">Entfernen</button>` : ""}
          <div class="msg" id="garmin-msg"></div>
        </div>
      </form>` })}
  </div>`;

  $("#main").querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => {
    state.open = state.open === b.dataset.open ? null : b.dataset.open;
    renderServices();
  }));

  // Nach dem Speichern neu zeichnen, damit Kennzeichen und Werte stimmen; die Meldung danach wieder setzen.
  const saved = (msgId, text) => { renderServices(); setMsg(msgId, text, true); };

  $("#server-form").addEventListener("submit", async e => {
    e.preventDefault();
    setMsg("server-msg", "Prüfe den Server …", true);
    if (await save({ server: { url: $("#url").value, apiKey: $("#apiKey").value } }, "server-msg")) saved("server-msg", "Server erreichbar, gespeichert");
  });

  $("#athletept-form").addEventListener("submit", async e => {
    e.preventDefault();
    const url = $("#athleteptUrl").value.trim();
    setMsg("athletept-msg", url ? "Prüfe AthletePT …" : "Entferne AthletePT …", true);
    if (await save({ athletept: { url, apiKey: $("#athleteptKey").value } }, "athletept-msg")) {
      saved("athletept-msg", url ? "AthletePT erreichbar, gespeichert" : "AthletePT entfernt");
    }
  });

  $("#garmin-form").addEventListener("submit", async e => {
    e.preventDefault();
    setMsg("garmin-msg", "Prüfe Garmin …", true);
    if (await save({ garmin: { apiKey: $("#garminKey").value } }, "garmin-msg")) saved("garmin-msg", "Garmin erreichbar, gespeichert");
  });
  $("#garmin-remove")?.addEventListener("click", async () => {
    if (await save({ garmin: null }, "garmin-msg")) saved("garmin-msg", "Garmin entfernt");
  });
}

// --- Slideshow ---

// Auf 800 × 480 zuschneiden (wie object-fit: cover) und als JPEG verkleinern.
async function resizeImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(SLIDE_W / bitmap.width, SLIDE_H / bitmap.height);
  const w = bitmap.width * scale, h = bitmap.height * scale;
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_W;
  canvas.height = SLIDE_H;
  canvas.getContext("2d").drawImage(bitmap, (SLIDE_W - w) / 2, (SLIDE_H - h) / 2, w, h);
  bitmap.close();
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

function renderSlides() {
  $("#main").innerHTML = `
    <div class="block">
      <div class="upload">
        <label class="primary wide" for="files"><span>Bilder hochladen</span>${icon("plus")}</label>
        <input type="file" id="files" accept="image/jpeg,image/png,image/webp" multiple>
        <span class="muted">${state.slides.length} von ${state.maxSlides} · werden auf 800 × 480 zugeschnitten</span>
      </div>
      <div class="msg" id="slides-msg"></div>
    </div>
    <div class="thumbs">${state.slides.map(name => `
      <div class="thumb">
        <img src="/api/slides/${encodeURIComponent(name)}" alt="" loading="lazy">
        <button class="secondary" data-delete="${esc(name)}">Löschen</button>
      </div>`).join("")}
    </div>`;

  $("#files").addEventListener("change", async e => {
    const files = [...e.target.files];
    let done = 0, failed = null;
    for (const file of files) {
      setMsg("slides-msg", `Lade hoch … ${done + 1} von ${files.length}`, true);
      try {
        const r = await api("slides", { method: "POST", blob: await resizeImage(file) });
        if (r.ok) done++;
        else failed = r.error;
      } catch {
        failed = `${file.name} ist kein lesbares Bild`;
      }
    }
    const list = await api("slides");
    if (list.ok) state.slides = list.data.slides;
    renderSlides();
    setMsg("slides-msg", failed ? `${done} hochgeladen. ${failed}` : `${done} hochgeladen`, !failed);
  });

  $("#main").querySelector(".thumbs").addEventListener("click", async e => {
    const name = e.target.dataset.delete;
    if (!name || !confirm("Bild löschen?")) return;
    const r = await api(`slides/${encodeURIComponent(name)}`, { method: "DELETE", body: {} });
    if (!r.ok) return setMsg("slides-msg", r.error);
    state.slides = state.slides.filter(n => n !== name);
    renderSlides();
  });
}

// --- System: Update, Status, Aktionen, Passwort ---

function renderSystem() {
  $("#main").innerHTML = `
    <div id="update"></div>
    <dl class="status-list" id="status"></dl>
    <div class="row wrap">
      <button class="secondary" data-action="wifi-reset">WLAN ändern</button>
      <button class="secondary" data-action="reboot">Neu starten</button>
      <button class="secondary" data-action="poweroff">Herunterfahren</button>
    </div>
    <div class="msg" id="action-msg"></div>
    <div class="kicker-row">PASSWORT ÄNDERN</div>
    <form class="block" id="password-form" novalidate>
      <div class="grid2">
        ${passwordField("current", "AKTUELLES PASSWORT", "current-password")}
        ${passwordField("next", "NEUES PASSWORT (MIN. 8 ZEICHEN)", "new-password")}
      </div>
      <div class="row"><button class="secondary">Ändern</button><div class="msg" id="password-msg"></div></div>
    </form>`;

  $("#update").addEventListener("click", e => {
    if (e.target.closest("#update-check")) checkUpdate();
    if (e.target.closest("#update-install")) installUpdate();
  });
  loadUpdate();

  $("#password-form").addEventListener("submit", async e => {
    e.preventDefault();
    const r = await api("password", { method: "POST", body: { current: $("#current").value, next: $("#next").value } });
    if (!r.ok) return setMsg("password-msg", r.error);
    $("#current").value = $("#next").value = "";
    setMsg("password-msg", "Geändert. Andere Sitzungen wurden abgemeldet.", true);
  });
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  return d ? `${d} T ${String(h).padStart(2, "0")} h` : `${h} h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")} min`;
}

const time = ts => (ts ? new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–");

// Zeichnet nur die Statusteile, die im aktuellen Bereich vorhanden sind; Eingaben bleiben unberührt.
function renderStatus() {
  const s = state.status;
  if (!s) return;
  $("#state").textContent = `${SETUP_LABELS[s.setup] ?? s.setup} · ${REST_LABELS[s.rest] ?? s.rest}`;

  const facts = $("#facts");
  if (facts) facts.innerHTML = [
    ["LETZTER SYNC", time(s.sync.planAt)],
    ["DISPLAY", REST_LABELS[s.rest] ?? s.rest],
    ["BILDER", String(s.slides)]
  ].map(([k, v]) => `<div class="fact"><div class="label">${k}</div><div class="fact-value">${esc(v)}</div></div>`).join("");

  const issue = $("#issue");
  if (issue) {
    const err = s.sync.planError ?? s.sync.weatherError;
    issue.innerHTML = err ? `
      <div class="issue">
        <div class="row">${icon("alert-triangle", 17)}<span>${esc(err.message)}</span></div>
        ${s.sync.planError ? `<button type="button" class="link" data-goto="services">Zu Dienste</button>` : ""}
      </div>` : "";
    issue.querySelector("[data-goto]")?.addEventListener("click", () => { state.tab = "services"; renderMain(); });
  }

  const list = $("#status");
  if (list) list.innerHTML = [
    ["WLAN", s.wifi ? `${s.wifi}${s.signal ? ` · ${s.signal} dBm` : ""}` : "–"],
    ["IP-Adresse", s.ip ?? "–"],
    ["Laufzeit", formatUptime(s.uptimeSec)],
    ["CPU-Temperatur", s.cpuTemp != null ? `${Math.round(s.cpuTemp)} °C` : "–"],
    ["Speicher", s.diskUsedPercent != null ? `${s.diskUsedPercent} % belegt` : "–"],
    ["Letzter Sync", s.sync.planError ? `${time(s.sync.planAt)} · ${s.sync.planError.message}` : time(s.sync.planAt)],
    ["Wetter", s.sync.weatherError ? s.sync.weatherError.message : time(s.sync.weatherAt)]
  ].map(([k, v]) => `<div class="status-row"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
}

async function refreshStatus() {
  const r = await api("status");
  if (!r.ok) return;
  state.status = r.data;
  renderStatus();
}

// Danach ist der Rahmen nicht mehr erreichbar; das Panel weicht einer Abschlussseite.
const power = (action, question, title, text) => async () => {
  if (!confirm(question)) return;
  const r = await api(action, { method: "POST", body: {} });
  if (!r.ok) return setMsg("action-msg", r.error);
  clearInterval(statusTimer);
  app.innerHTML = authLayout(`<div class="field"><h1>${title}</h1><div class="muted">${text}</div></div>`);
};

const ACTIONS = {
  async sync() {
    const button = $("[data-action=sync]");
    button.disabled = true;
    setMsg("action-msg", "Lade Plan und Wetter …", true);
    const r = await api("sync", { method: "POST", body: {} });
    button.disabled = false;
    if (!r.ok) return setMsg("action-msg", r.error);
    state.status = r.data;
    renderStatus();
    const err = r.data.sync.planError ?? r.data.sync.weatherError;
    setMsg("action-msg", err ? err.message : "Aktualisiert", !err);
  },
  "wifi-reset": power("wifi-reset",
    "WLAN wirklich ändern? Der Rahmen trennt sich vom Heimnetz und öffnet wieder seinen Hotspot. Danach geht es auf dem Display mit Schritt 1 weiter; das Admin-Passwort bleibt.",
    "Hotspot ist offen", "Folge den Schritten auf dem Display."),
  reboot: power("reboot",
    "Rahmen wirklich neu starten? Das dauert etwa eine Minute.",
    "Rahmen startet neu", "Lade diese Seite in etwa einer Minute neu."),
  poweroff: power("poweroff",
    "Rahmen wirklich herunterfahren? Einschalten geht danach nur, indem du den Strom kurz trennst.",
    "Rahmen fährt herunter", "Den Strom erst trennen, wenn die grüne LED am Pi nicht mehr blinkt.")
};

// --- Update per Knopf ---

const short = commit => (commit ? commit.slice(0, 7) : "–");
const UPDATE_DONE = { done: "ok", current: "ok", failed: "error" };

function renderUpdate(info, { changes = null, message = null, ok = true } = {}) {
  const box = $("#update");
  if (!box) return;
  const last = info.lastRun;
  const lastText = last && last.state !== "running"
    ? `Letztes Update ${new Date(last.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}: ${last.message}`
    : "";
  const available = changes?.length > 0;
  box.innerHTML = `
    <div class="hero">
      <div class="field">
        <div class="label">SOFTWARE</div>
        <div class="hero-title">Version ${esc(short(info.commit))}${available ? " · Update verfügbar" : ""}</div>
        <div class="page-sub small">${esc(`${info.remote}/${info.branch}`)}</div>
      </div>
      ${available
        ? `<button class="primary wide" id="update-install"><span>Installieren</span>${icon("download")}</button>`
        : `<button class="secondary wide" id="update-check"${info.running ? " disabled" : ""}><span>Nach Updates suchen</span>${icon("refresh-cw")}</button>`}
    </div>
    ${available ? `
      <div class="field changes">
        <div class="label">${changes.length} NEUE ÄNDERUNG${changes.length === 1 ? "" : "EN"}</div>
        <div class="muted" style="font-size:13px;line-height:1.5">${changes.map(esc).join("<br>")}</div>
      </div>` : ""}
    <div class="msg ${ok ? "ok" : "error"}" id="update-msg">${esc(message ?? lastText)}</div>`;
}

async function loadUpdate(opts) {
  const r = await api("update");
  if (r.ok) renderUpdate(r.data, opts);
  return r.ok ? r.data : null;
}

async function checkUpdate() {
  setMsg("update-msg", "Suche …", true);
  const r = await api("update/check", { method: "POST", body: {} });
  if (!r.ok) return setMsg("update-msg", r.error);
  if (r.data.ahead) return loadUpdate({ message: "Lokale Änderungen auf dem Rahmen, Update per Knopf nicht möglich", ok: false });
  loadUpdate({ changes: r.data.changes, message: r.data.changes.length ? "" : "Bereits aktuell" });
}

// Während des Updates startet der Daemon neu; Fehler beim Abfragen heißen dann nur „startet neu“.
async function installUpdate() {
  if (!confirm("Update installieren? Der Rahmen startet dabei kurz neu.")) return;
  const r = await api("update/install", { method: "POST", body: {} });
  if (!r.ok) return setMsg("update-msg", r.error);
  const started = r.data.lastRun?.at ?? Date.now();
  renderUpdate(r.data, { message: "Update läuft …" });
  const poll = async () => {
    let info = null;
    try {
      const res = await fetch("/api/admin/update");
      if (res.ok) info = await res.json();
    } catch {}
    if (!info) return setMsg("update-msg", "Rahmen startet neu …", true), setTimeout(poll, UPDATE_POLL_MS);
    const last = info.lastRun;
    if (last && last.at >= started && UPDATE_DONE[last.state]) {
      renderUpdate(info, { message: last.message, ok: UPDATE_DONE[last.state] === "ok" });
      return;
    }
    setMsg("update-msg", last?.message ? `${last.message} …` : "Update läuft …", true);
    setTimeout(poll, UPDATE_POLL_MS);
  };
  setTimeout(poll, UPDATE_POLL_MS);
}

async function start() {
  const r = await api("session");
  const view = { setup: showSetup, login: showLogin, ok: showPanel }[r.data?.state] ?? showUnavailable;
  view();
}

start();
