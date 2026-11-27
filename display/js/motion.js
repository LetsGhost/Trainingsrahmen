// Übergänge zwischen den Screens, Zeiten und Easings aus Animationen-demo.html; gleich für Modern und Sport.
// Nur transform und opacity (Pi 3B+). Der alte Screen bleibt als Kopie („Ghost“) über bzw. unter #frame liegen,
// #frame zeigt schon den neuen. Alle Ebenen liegen in derselben Grid-Zelle von body (display.css: .frame, .mx-layer).
const EASE_OUT = "cubic-bezier(.2,.8,.2,1)", EASE_IN = "cubic-bezier(.4,0,1,1)", EASE = "cubic-bezier(.4,0,.2,1)";
const W = 800, H = 480;
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const D = ms => (reduce.matches ? 1 : ms);

let running = false;
export const busy = () => running;

// Alle laufenden Animationen; run() bricht sie am Ende ab, damit fill: "both" nichts stehen lässt.
let started = [];
function anim(el, frames, duration, easing, delay = 0) {
  const a = el.animate(frames, { duration: D(duration), delay: D(delay), easing, fill: "both" });
  started.push(a);
  return a.finished;
}

function rel(frame, el) {
  const a = el.getBoundingClientRect(), f = frame.getBoundingClientRect();
  return { x: a.left - f.left, y: a.top - f.top, w: a.width, h: a.height };
}

function layer(el, z) {
  el.classList.add("mx-layer");
  el.style.zIndex = z;
  document.body.appendChild(el);
  return el;
}

// Kopie des aktuellen Screens; ohne ids, sonst schreibt z. B. der Sensor-Poll in die Kopie.
function ghost(frame, z) {
  const g = frame.cloneNode(true);
  g.removeAttribute("id");
  g.querySelectorAll("[id]").forEach(e => e.removeAttribute("id"));
  g.classList.add("mx-ghost");
  return layer(g, z);
}

// Kopie anlegen, dann den neuen Screen zeichnen. null, wenn er derselbe bleibt (z. B. Tag ohne geladenen Plan).
function swap(frame, z, apply) {
  const before = frame.dataset.screen;
  const old = ghost(frame, z);
  apply();
  if (frame.dataset.screen !== before) return old;
  old.remove();
  return null;
}

const surface = (z, background) => {
  const d = document.createElement("div");
  d.style.background = background;
  return layer(d, z);
};

// Alles im Screen außer dem geteilten Element und seinen Vorfahren, so grob wie möglich.
function fxTargets(root, shared) {
  return [...root.children].flatMap(c => (c === shared ? [] : shared && c.contains(shared) ? fxTargets(c, shared) : [c]));
}

// Geteiltes Element nur, wenn Quelle und Ziel dasselbe zeigen (z. B. keine Erholungszahl → kein Flug).
const pair = (a, b) => (a && b && a.textContent.trim() === b.textContent.trim() ? [a, b] : [null, null]);
const flip = (a, b) => `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${a.h / b.h})`;
const rectTransform = r => `translate(${r.x}px, ${r.y}px) scale(${r.w / W}, ${r.h / H})`;

async function run(frame, layers, work) {
  running = true;
  try {
    await work();
  } catch {} // abgebrochene Animation: trotzdem aufräumen
  layers.forEach(l => l.remove());
  started.forEach(a => a.cancel());
  started = [];
  frame.style.zIndex = frame.style.background = "";
  running = false;
}

// Woche → Tag / Wetter / Erholung. src: { box, shared?, target? } als Selektoren.
export async function open(frame, src, apply) {
  const box = frame.querySelector(src.box);
  if (!box) return apply();
  const r = rel(frame, box);
  const weekBg = getComputedStyle(frame).backgroundColor;
  const old = swap(frame, 1, apply);
  if (!old) return;
  const [from, to] = pair(src.shared && old.querySelector(src.shared), src.target && frame.querySelector(src.target));
  const base = surface(0, weekBg);
  const morph = surface(2, getComputedStyle(frame).backgroundColor);
  frame.style.zIndex = 3;
  frame.style.background = "transparent";
  await run(frame, [base, old, morph], () => {
    const jobs = [
      anim(morph, [{ transform: rectTransform(r) }, { transform: "none" }], 300, EASE_OUT),
      anim(old, [{ opacity: 1 }, { opacity: 0 }], 160, EASE),
      ...fxTargets(frame, to).map(e => anim(e, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], 220, EASE_OUT, 140))
    ];
    if (to) {
      from.style.visibility = "hidden";
      to.style.transformOrigin = "0 0";
      jobs.push(anim(to, [{ transform: flip(rel(frame, from), rel(frame, to)) }, { transform: "none" }], 340, EASE_OUT)
        .finally(() => (to.style.transformOrigin = "")));
    }
    return Promise.all(jobs);
  });
}

// Zurück zur Woche, rückwärts zur selben Quelle.
export async function close(frame, src, apply) {
  const background = getComputedStyle(frame).backgroundColor;
  const old = swap(frame, 3, apply);
  if (!old) return;
  old.style.background = "transparent";
  const box = frame.querySelector(src.box);
  if (!box) return old.remove();
  const r = rel(frame, box);
  const [to, from] = pair(src.target && old.querySelector(src.target), src.shared && frame.querySelector(src.shared));
  const base = surface(0, getComputedStyle(frame).backgroundColor);
  const morph = surface(2, background);
  frame.style.zIndex = 1;
  await run(frame, [base, old, morph], () => {
    const jobs = [
      ...fxTargets(old, to).map(e => anim(e, [{ opacity: 1 }, { opacity: 0 }], 120, EASE_IN)),
      anim(morph, [{ transform: "none", opacity: 1 }, { transform: rectTransform(r), opacity: 1 }, { transform: rectTransform(r), opacity: 0 }], 340, EASE),
      anim(frame, [{ opacity: 0 }, { opacity: 1 }], 220, EASE, 120)
    ];
    if (to) {
      from.style.visibility = "hidden";
      to.style.transformOrigin = "0 0";
      jobs.push(anim(to, [{ transform: "none" }, { transform: flip(rel(frame, from), rel(frame, to)) }], 300, EASE)
        .finally(() => (from.style.visibility = "")));
    }
    return Promise.all(jobs);
  });
}

// Einstellungen: Panel über den ganzen Bildschirm von unten, darunter abgedunkelt.
export async function sheetUp(frame, _src, apply) {
  const old = swap(frame, 1, apply);
  if (!old) return;
  const scrim = surface(2, "#000");
  frame.style.zIndex = 3;
  await run(frame, [old, scrim], () => Promise.all([
    anim(scrim, [{ opacity: 0 }, { opacity: 0.55 }], 220, EASE),
    anim(frame, [{ transform: "translateY(100%)" }, { transform: "none" }], 320, EASE_OUT)
  ]));
}

export async function sheetDown(frame, _src, apply) {
  const old = swap(frame, 3, apply);
  if (!old) return;
  const scrim = surface(2, "#000");
  frame.style.zIndex = 1;
  await run(frame, [old, scrim], () => Promise.all([
    anim(scrim, [{ opacity: 0.55 }, { opacity: 0 }], 220, EASE),
    anim(old, [{ transform: "none" }, { transform: "translateY(100%)" }], 240, EASE_IN)
  ]));
}

// Auto-Zurück nach 60 s: Woche blendet langsam über den aktuellen Screen.
export async function fade(frame, _src, apply) {
  const old = swap(frame, 1, apply);
  if (!old) return;
  const base = surface(0, getComputedStyle(frame).backgroundColor);
  frame.style.zIndex = 2;
  await run(frame, [base, old], () => Promise.all([
    anim(frame, [{ opacity: 0 }, { opacity: 1 }], 900, EASE),
    anim(old, [{ opacity: 1 }, { opacity: 0 }], 900, EASE)
  ]));
}

// Aufwachen aus AUS: Schwarz blendet aus, der Inhalt wächst minimal auf.
export async function wake(frame) {
  const black = surface(3, "#000");
  await run(frame, [black], () => Promise.all([
    anim(black, [{ opacity: 1 }, { opacity: 0 }], 600, EASE),
    anim(frame, [{ transform: "scale(.985)" }, { transform: "none" }], 600, EASE_OUT)
  ]));
}
