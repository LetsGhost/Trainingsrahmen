// Einrichtungsportal: WLAN wählen, Passwort, Server-URL und API-Key an den Rahmen schicken.
// Nach dem Absenden schließt der Rahmen seinen Hotspot; das Handy verliert dann die Verbindung.
const OTHER = "__other__";

const view = document.getElementById("view");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { daemon: null, networks: null, sent: null, formError: null };
// Eingaben überleben ein Neuzeichnen (z. B. wenn per SSE ein neuer Zustand kommt).
const draft = { ssid: null, other: "", password: "", url: "", apiKey: "" };

function message(title, text) {
  return `
    <div class="p-message">
      <div class="p-message-title">${esc(title)}</div>
      <div class="p-message-text">${esc(text)}</div>
    </div>`;
}

function signalLabel(n) {
  return `${n.signal >= 70 ? "stark" : n.signal >= 40 ? "mittel" : "schwach"}${n.secure ? "" : " · offen"}`;
}

function renderNetworks() {
  if (!state.networks) return `<div class="p-hint">Suche WLANs …</div>`;
  const rows = state.networks.map(n => `
    <label class="p-network">
      <input type="radio" name="ssid" value="${esc(n.ssid)}"${draft.ssid === n.ssid ? " checked" : ""}>
      <span class="p-network-name">${esc(n.ssid)}</span>
      <span class="p-network-meta">${signalLabel(n)}</span>
    </label>`).join("");
  return `<div class="p-networks">${rows}
    <label class="p-network">
      <input type="radio" name="ssid" value="${OTHER}"${draft.ssid === OTHER ? " checked" : ""}>
      <span class="p-network-name">Anderes Netz …</span>
    </label>
  </div>
  ${draft.ssid === OTHER ? `<input type="text" name="other" placeholder="Name des WLANs" value="${esc(draft.other)}" autocapitalize="off" autocorrect="off">` : ""}`;
}

function renderForm() {
  const f = state.daemon;
  const error = state.formError ?? (f?.error ? `Letzter Versuch: ${f.error.message}` : null);
  return `
    ${error ? `<div class="p-error">${esc(error)}</div>` : ""}
    <form id="form" novalidate>
      <div class="p-field">
        <div class="p-row" style="justify-content:space-between;align-items:center">
          <span class="p-label">HEIM-WLAN</span>
          <button type="button" class="p-secondary" id="rescan">Neu suchen</button>
        </div>
        ${renderNetworks()}
      </div>
      <div class="p-field">
        <label class="p-label" for="password">WLAN-PASSWORT</label>
        <div class="p-row">
          <input type="password" id="password" name="password" value="${esc(draft.password)}" autocomplete="off">
          <button type="button" class="p-secondary" id="reveal">Zeigen</button>
        </div>
      </div>
      <div class="p-field">
        <label class="p-label" for="url">SERVER-URL</label>
        <input type="url" id="url" name="url" placeholder="https://…" value="${esc(draft.url)}" autocapitalize="off" autocorrect="off">
      </div>
      <div class="p-field">
        <label class="p-label" for="apiKey">API-KEY</label>
        <input type="text" id="apiKey" name="apiKey" value="${esc(draft.apiKey)}" autocapitalize="off" autocorrect="off" spellcheck="false">
      </div>
      <button class="p-primary" id="submit">Verbinden</button>
    </form>`;
}

function render() {
  const f = state.daemon;
  if (state.sent || f?.connecting) {
    view.innerHTML = message(
      `Verbinde mit ${state.sent ?? f.connectingTo} …`,
      "Schau jetzt auf den Rahmen. Dein Handy trennt sich gleich vom WLAN des Rahmens. Klappt etwas nicht, öffnet der Rahmen sein WLAN nach 30 Sekunden wieder."
    );
  } else if (f && f.setup !== "SETUP_HOTSPOT" && f.setup !== "SETUP_ACCOUNT") {
    view.innerHTML = message("Der Rahmen ist eingerichtet.", "Du kannst diese Seite schließen.");
  } else {
    view.innerHTML = renderForm();
  }
}

// Eingaben bei jeder Änderung in draft übernehmen.
view.addEventListener("input", e => {
  const { name, value } = e.target;
  if (name in draft) draft[name] = value;
  if (name === "ssid") render();
});

view.addEventListener("click", e => {
  if (e.target.id === "rescan") scan();
  if (e.target.id === "reveal") {
    const input = document.getElementById("password");
    input.type = input.type === "password" ? "text" : "password";
    e.target.textContent = input.type === "password" ? "Zeigen" : "Verbergen";
  }
});

view.addEventListener("submit", async e => {
  e.preventDefault();
  const ssid = draft.ssid === OTHER ? draft.other.trim() : draft.ssid;
  if (!ssid) {
    state.formError = "Bitte ein WLAN wählen.";
    return render();
  }
  document.getElementById("submit").disabled = true;
  try {
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wifi: { ssid, password: draft.password }, server: { url: draft.url, apiKey: draft.apiKey } })
    });
    if (!res.ok) {
      state.formError = (await res.json()).error;
    } else {
      state.formError = null;
      state.sent = ssid;
    }
  } catch {
    state.formError = "Der Rahmen antwortet nicht. Bist du noch mit seinem WLAN verbunden?";
  }
  render();
});

async function scan() {
  state.networks = null;
  render();
  try {
    state.networks = await (await fetch("/api/setup/networks")).json();
    if (!Array.isArray(state.networks)) state.networks = [];
  } catch {
    state.networks = [];
  }
  if (draft.ssid === null && state.networks[0]) draft.ssid = state.networks[0].ssid;
  render();
}

new EventSource("/events").onmessage = e => {
  const prev = state.daemon;
  state.daemon = JSON.parse(e.data).frame;
  // Kommt der Hotspot nach einem Fehler zurück, darf erneut abgesendet werden.
  if (state.sent && state.daemon.error && !state.daemon.connecting) state.sent = null;
  // Nur neu zeichnen, wenn sich etwas Sichtbares ändert; sonst springt der Fokus aus dem Eingabefeld.
  const key = f => f && [f.setup, f.connecting, f.error?.code].join("|");
  if (key(prev) !== key(state.daemon)) render();
};

render();
scan();
