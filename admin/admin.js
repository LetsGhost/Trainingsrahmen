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

const state = { tab: "settings", settings: null, status: null, slides: [], maxSlides: 200, geo: [] };
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

// --- Panel (1E) ---

async function showPanel() {
  app.innerHTML = `
    <header class="top">
      <div class="top-left">
        <div class="brand">TRAININGSRAHMEN <span>ADMIN</span></div>
        <nav class="tabs">
          <button class="tab" data-tab="settings">Einstellungen</button>
          <button class="tab" data-tab="slides">Slideshow</button>
        </nav>
      </div>
      <div class="top-right">
        <div class="state" id="state"></div>
        <button class="secondary" id="logout">Abmelden</button>
      </div>
    </header>
    <div class="panel">
      <main class="main" id="main"></main>
      <div class="panel-divider"></div>
      <aside class="side" id="side"></aside>
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

  const [settings, slides] = await Promise.all([api("settings"), api("slides")]);
  if (!settings.ok) return;
  state.settings = settings.data;
  if (slides.ok) Object.assign(state, { slides: slides.data.slides, maxSlides: slides.data.max });
  renderMain();
  renderSide();
  refreshStatus();
  clearInterval(statusTimer);
  statusTimer = setInterval(refreshStatus, STATUS_REFRESH_MS);
}

function renderMain() {
  document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === state.tab));
  if (state.tab === "slides") renderSlides();
  else renderSettings();
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

function toggle(name, options, current) {
  return `<div class="toggle" data-toggle="${name}">${options.map(([value, label]) =>
    `<button type="button" data-value="${value}" class="${String(current) === String(value) ? "on" : ""}">${label}</button>`).join("")}</div>`;
}

function renderSettings() {
  const s = state.settings;
  $("#main").innerHTML = `
    <div class="section-head">
      <div class="kicker">ZUGANGSDATEN</div>
      <div class="section-title">Server & API-Key</div>
    </div>
    <form class="block" id="server-form" novalidate>
      <div class="grid2">
        <div class="field">
          <label class="label" for="url">SERVER-URL</label>
          <input type="url" id="url" value="${esc(s.server.url)}" placeholder="https://…">
        </div>
        <div class="field">
          <label class="label" for="apiKey">API-KEY</label>
          <input type="text" id="apiKey" placeholder="${esc(s.server.apiKey)} · leer lassen zum Behalten" autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div class="row"><button class="secondary">Prüfen & speichern</button><div class="msg" id="server-msg"></div></div>
    </form>

    <div class="section-head">
      <div class="kicker">ZUSÄTZLICHE QUELLE</div>
      <div class="section-title">AthletePT</div>
      <div class="setting-hint">Optional. Die Trainings aus AthletePT erscheinen zusätzlich im Plan. URL leeren und speichern entfernt die Quelle.</div>
    </div>
    <form class="block" id="athletept-form" novalidate>
      <div class="grid2">
        <div class="field">
          <label class="label" for="athleteptUrl">ATHLETEPT-URL</label>
          <input type="url" id="athleteptUrl" value="${esc(s.athletept.url)}" placeholder="https://…">
        </div>
        <div class="field">
          <label class="label" for="athleteptKey">API-KEY</label>
          <input type="text" id="athleteptKey" placeholder="${esc(s.athletept.apiKey)} · leer lassen zum Behalten" autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div class="row"><button class="secondary">Prüfen & speichern</button><div class="msg" id="athletept-msg"></div></div>
    </form>

    <div class="section-head">
      <div class="kicker">ANZEIGE</div>
      <div class="section-title">Ort, Erscheinungsbild & Module</div>
    </div>
    <div class="block">
      <form class="field" id="geo-form" novalidate>
        <label class="label" for="geo">ORT (WETTER) · AKTUELL ${esc(s.location.name.toUpperCase())}</label>
        <div class="row"><input type="text" id="geo" placeholder="Ort suchen"><button class="secondary">Suchen</button></div>
        <div class="results" id="geo-results"></div>
        <div class="msg" id="geo-msg"></div>
      </form>
      <div class="setting">
        <div>
          <div class="setting-name">Erscheinungsbild</div>
          <div class="setting-hint">Automatisch folgt dem Nachtfenster 22:00 – 06:00</div>
        </div>
        ${toggle("theme", [["light", "HELL"], ["dark", "DUNKEL"], ["auto", "AUTO"]], s.display.theme)}
      </div>
      <div class="setting">
        <div><div class="setting-name">Wetter</div><div class="setting-hint">Kopfzeile und Tagesansicht</div></div>
        ${toggle("showWeather", [[true, "AN"], [false, "AUS"]], s.display.showWeather)}
      </div>
      <div class="setting">
        <div><div class="setting-name">Erholung & Schlaf</div><div class="setting-hint">Leiste unten</div></div>
        ${toggle("showRecovery", [[true, "AN"], [false, "AUS"]], s.display.showRecovery)}
      </div>
      <div class="msg" id="display-msg"></div>
    </div>

    <div class="section-head">
      <div class="kicker">RUHE</div>
      <div class="section-title">Slideshow & Display aus</div>
    </div>
    <form class="block" id="rest-form" novalidate>
      <div class="grid2">
        <div class="field">
          <label class="label" for="slideshowAfter">SLIDESHOW NACH (MINUTEN)</label>
          <input type="number" id="slideshowAfter" min="1" max="120" value="${s.deadlines.slideshowAfterMin}">
        </div>
        <div class="field">
          <label class="label" for="offAfter">DISPLAY AUS NACH (MINUTEN)</label>
          <input type="number" id="offAfter" min="2" max="600" value="${s.deadlines.offAfterMin}">
        </div>
      </div>
      <div class="setting-hint">Gezählt ab der letzten Bewegung oder Berührung. Ohne Bilder geht das Display schon nach der ersten Frist aus.</div>
      <div class="row"><button class="secondary">Speichern</button><div class="msg" id="rest-msg"></div></div>
    </form>`;

  $("#server-form").addEventListener("submit", async e => {
    e.preventDefault();
    setMsg("server-msg", "Prüfe den Server …", true);
    if (await save({ server: { url: $("#url").value, apiKey: $("#apiKey").value } }, "server-msg", "Server erreichbar, gespeichert")) {
      $("#apiKey").value = "";
      $("#apiKey").placeholder = `${state.settings.server.apiKey} · leer lassen zum Behalten`;
    }
  });

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
    if (await save({ location: { name: g.name, lat: g.lat, lon: g.lon } }, "geo-msg", `Ort: ${g.name}`)) renderSettings();
  });

  $("#athletept-form").addEventListener("submit", async e => {
    e.preventDefault();
    const url = $("#athleteptUrl").value.trim();
    setMsg("athletept-msg", url ? "Prüfe AthletePT …" : "Entferne AthletePT …", true);
    if (await save({ athletept: { url, apiKey: $("#athleteptKey").value } }, "athletept-msg", url ? "AthletePT erreichbar, gespeichert" : "AthletePT entfernt")) {
      $("#athleteptKey").value = "";
      $("#athleteptKey").placeholder = `${state.settings.athletept.apiKey} · leer lassen zum Behalten`;
    }
  });

  document.querySelectorAll("[data-toggle]").forEach(t => t.addEventListener("click", async e => {
    const value = e.target.dataset.value;
    if (value === undefined) return;
    const display = { ...state.settings.display, [t.dataset.toggle]: t.dataset.toggle === "theme" ? value : value === "true" };
    if (await save({ display }, "display-msg")) {
      t.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.target));
    }
  }));

  $("#rest-form").addEventListener("submit", e => {
    e.preventDefault();
    save({ deadlines: { slideshowAfterMin: Number($("#slideshowAfter").value), offAfterMin: Number($("#offAfter").value) } }, "rest-msg");
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
    <div class="section-head">
      <div class="kicker">SLIDESHOW</div>
      <div class="section-title">Bilder</div>
    </div>
    <div class="block">
      <div class="upload">
        <label class="primary" for="files"><span>Bilder hochladen</span><span>+</span></label>
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

// --- Seitenleiste: Status, Aktionen, Passwort ---

function formatUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  return d ? `${d} T ${String(h).padStart(2, "0")} h` : `${h} h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")} min`;
}

const time = ts => (ts ? new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–");

function renderStatus() {
  const s = state.status;
  if (!s) return;
  $("#state").textContent = `${SETUP_LABELS[s.setup] ?? s.setup} · ${REST_LABELS[s.rest] ?? s.rest}`;
  const rows = [
    ["WLAN", s.wifi ? `${s.wifi}${s.signal ? ` · ${s.signal} dBm` : ""}` : "–"],
    ["IP im Netz", s.ip ?? "–"],
    ["Uptime", formatUptime(s.uptimeSec)],
    ["CPU-Temperatur", s.cpuTemp != null ? `${Math.round(s.cpuTemp)} °C` : "–"],
    ["Speicher", s.diskUsedPercent != null ? `${s.diskUsedPercent} % belegt` : "–"],
    ["Letzter Sync", s.sync.planError ? `${time(s.sync.planAt)} · ${s.sync.planError.message}` : time(s.sync.planAt)],
    ["Wetter", s.sync.weatherError ? s.sync.weatherError.message : time(s.sync.weatherAt)]
  ];
  $("#status").innerHTML = rows.map(([k, v]) => `<div class="status-row"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
}

async function refreshStatus() {
  const r = await api("status");
  if (!r.ok) return;
  state.status = r.data;
  renderStatus();
}

function renderSide() {
  $("#side").innerHTML = `
    <div class="section-head">
      <div class="kicker">SYSTEM</div>
      <div class="section-title">Status</div>
    </div>
    <dl class="status-list" id="status"></dl>
    <div class="side-actions">
      <button class="primary" id="sync"><span>Jetzt neu laden</span><span>↻</span></button>
      <button class="secondary" id="wifi-reset">WLAN ändern</button>
      <button class="secondary" id="reboot">Neu starten</button>
      <button class="secondary" id="poweroff">Herunterfahren</button>
      <div class="msg" id="side-msg"></div>
    </div>
    <div class="section-head">
      <div class="kicker">UPDATE</div>
      <div class="section-title">Software</div>
    </div>
    <div class="side-actions" id="update"></div>
    <div class="section-head">
      <div class="kicker">ZUGANG</div>
      <div class="section-title">Passwort ändern</div>
    </div>
    <form class="side-actions" id="password-form" novalidate>
      ${passwordField("current", "AKTUELLES PASSWORT", "current-password")}
      ${passwordField("next", "NEUES PASSWORT (MIN. 8 ZEICHEN)", "new-password")}
      <button class="secondary">Ändern</button>
      <div class="msg" id="password-msg"></div>
    </form>`;

  $("#sync").addEventListener("click", async () => {
    $("#sync").disabled = true;
    setMsg("side-msg", "Lade Plan und Wetter …", true);
    const r = await api("sync", { method: "POST", body: {} });
    $("#sync").disabled = false;
    if (!r.ok) return setMsg("side-msg", r.error);
    state.status = r.data;
    renderStatus();
    const err = r.data.sync.planError ?? r.data.sync.weatherError;
    setMsg("side-msg", err ? err.message : "Aktualisiert", !err);
  });

  $("#wifi-reset").addEventListener("click", async () => {
    if (!confirm("WLAN wirklich ändern? Der Rahmen trennt sich vom Heimnetz und öffnet wieder seinen Hotspot. Danach geht es auf dem Display mit Schritt 1 weiter; das Admin-Passwort bleibt.")) return;
    const r = await api("wifi-reset", { method: "POST", body: {} });
    if (!r.ok) return setMsg("side-msg", r.error);
    clearInterval(statusTimer);
    app.innerHTML = authLayout(`<div class="field"><h1>Hotspot ist offen</h1><div class="muted">Folge den Schritten auf dem Display.</div></div>`);
  });

  const power = (action, question, title, text) => async () => {
    if (!confirm(question)) return;
    const r = await api(action, { method: "POST", body: {} });
    if (!r.ok) return setMsg("side-msg", r.error);
    clearInterval(statusTimer);
    app.innerHTML = authLayout(`<div class="field"><h1>${title}</h1><div class="muted">${text}</div></div>`);
  };
  $("#reboot").addEventListener("click", power("reboot",
    "Rahmen wirklich neu starten? Das dauert etwa eine Minute.",
    "Rahmen startet neu", "Lade diese Seite in etwa einer Minute neu."));
  $("#poweroff").addEventListener("click", power("poweroff",
    "Rahmen wirklich herunterfahren? Einschalten geht danach nur, indem du den Strom kurz trennst.",
    "Rahmen fährt herunter", "Den Strom erst trennen, wenn die grüne LED am Pi nicht mehr blinkt."));

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

// --- Update per Knopf ---

const short = commit => (commit ? commit.slice(0, 7) : "–");
const UPDATE_DONE = { done: "ok", current: "ok", failed: "error" };

function renderUpdate(info, { changes = null, message = null, ok = true } = {}) {
  const last = info.lastRun;
  const lastText = last && last.state !== "running"
    ? `Letztes Update ${new Date(last.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}: ${last.message}`
    : "";
  $("#update").innerHTML = `
    <dl class="status-list" style="margin:0">
      <div class="status-row"><dt>Version</dt><dd>${esc(short(info.commit))}</dd></div>
      <div class="status-row"><dt>Branch</dt><dd>${esc(`${info.remote}/${info.branch}`)}</dd></div>
    </dl>
    ${changes?.length ? `
      <div class="field">
        <div class="label">${changes.length} NEUE ÄNDERUNG${changes.length === 1 ? "" : "EN"}</div>
        <div class="muted" style="font-size:13px;line-height:1.5">${changes.map(esc).join("<br>")}</div>
      </div>
      <button class="primary" id="update-install"><span>Installieren</span><span>↓</span></button>` : ""}
    <button class="secondary" id="update-check"${info.running ? " disabled" : ""}>Nach Updates suchen</button>
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
