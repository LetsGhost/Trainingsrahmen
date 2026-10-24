// Dev-Leiste: zeigt den Zustand des Daemons live an und schickt Aktionen an /api/debug.
const SETUP_STATES = ["SETUP_HOTSPOT", "SETUP_ACCOUNT", "SETUP_ADMIN", "READY", "OFFLINE"];
const REST_STATES = ["AKTIV", "SLIDESHOW", "AUS"];

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function send(action, body = {}) {
  const res = await fetch("/api/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body })
  });
  if (!res.ok) alert((await res.json()).error);
}

function makeButtons(container, states, key) {
  container.innerHTML = states.map(s => `<button data-${key}="${s}">${s}</button>`).join("");
  container.addEventListener("click", e => {
    const value = e.target.dataset[key];
    if (value) send("force", { [key]: value });
  });
}

const time = ts => (ts ? new Date(ts).toLocaleTimeString("de-DE") : "–");

function renderSync(s) {
  const rows = [
    ["Plan", time(s.planAt)],
    ["Plan-Fehler", s.planError ? `${s.planError.code}: ${s.planError.message}` : "–"],
    ["Garmin", time(s.garminAt)],
    ["Garmin-Fehler", s.garminError ? `${s.garminError.code}: ${s.garminError.message}` : "–"],
    ["Wetter", time(s.weatherAt)],
    ["Wetter-Fehler", s.weatherError ? `${s.weatherError.code}: ${s.weatherError.message}` : "–"]
  ];
  $("#sync-status").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
}

function renderStatus({ frame: f, sync, dev }) {
  renderSync(sync);
  const sys = f.system;
  const rows = [
    ["Einrichtung", f.setup ?? "–"],
    ["Ruhe", f.rest],
    ["Verbinde", f.connecting ? "ja" : "nein"],
    ["Admin-Code", f.adminCode ?? "–"],
    ["Hotspot", sys.hotspot ? `${sys.hotspot.ssid} / ${sys.hotspot.password}` : "aus"],
    ["WLAN", sys.wifi ?? "–"],
    ["Backlight", sys.backlight ? "an" : "aus"],
    ["CPU", f.cpuTemp != null ? `${f.cpuTemp} °C` : "–"]
  ];
  $("#status").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
  $("#error").hidden = !f.error;
  $("#error").textContent = f.error ? `${f.error.code}: ${f.error.message}` : "";

  document.querySelectorAll("[data-setup]").forEach(b => b.classList.toggle("on", b.dataset.setup === f.setup));
  document.querySelectorAll("[data-rest]").forEach(b => b.classList.toggle("on", b.dataset.rest === f.rest));
  document.querySelectorAll("[data-sim]").forEach(c => { c.checked = dev.sim[c.dataset.sim]; });
  $("#deadlines").value = f.deadlines.offAfterMin < 1 ? "short" : "normal";
  $("#theme").value = dev.theme ?? "";
  $("#plan").value = dev.plan;
}

// Das Display hat feste 800 × 480; die Vorschau skaliert es auf die verfügbare Breite.
function fitPreview() {
  const scale = Math.min(1, $("#preview").clientWidth / 800);
  $("#display").style.transform = `scale(${scale})`;
  $("#preview").style.height = `${480 * scale}px`;
}

async function init() {
  makeButtons($("#force-setup"), SETUP_STATES, "setup");
  makeButtons($("#force-rest"), REST_STATES, "rest");

  const fixtures = await (await fetch("/api/debug/fixtures")).json();
  $("#plan").innerHTML = fixtures.map(f => `<option>${esc(f)}</option>`).join("");

  document.querySelectorAll("button[data-action]").forEach(b => b.addEventListener("click", () => send(b.dataset.action)));
  document.querySelectorAll("[data-sim]").forEach(c =>
    c.addEventListener("change", () => send("sim", { key: c.dataset.sim, value: c.checked })));
  $("#deadlines").addEventListener("change", e => send("deadlines", { preset: e.target.value }));
  $("#theme").addEventListener("change", e => send("theme", { theme: e.target.value || null }));
  $("#plan").addEventListener("change", e => send("plan", { file: e.target.value }));

  $("#submit").addEventListener("submit", e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    send("submit", { wifi: { ssid: v.ssid, password: v.password }, server: { url: v.url, apiKey: v.apiKey },
      athletept: { url: v.athleteptUrl, apiKey: v.athleteptKey } });
  });
  $("#garmin").addEventListener("submit", e => {
    e.preventDefault();
    send("garmin", { apiKey: new FormData(e.target).get("apiKey") });
  });
  $("#clock").addEventListener("submit", e => {
    e.preventDefault();
    const value = new FormData(e.target).get("now");
    if (value) send("clock", { now: value });
  });
  $("#clock-reset").addEventListener("click", () => send("clock", { now: null }));

  new EventSource("/events").onmessage = e => renderStatus(JSON.parse(e.data));

  fitPreview();
  addEventListener("resize", fitPreview);
}

init();
