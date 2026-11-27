// Slideshow: zwei <img>, das nächste Bild wird vorab dekodiert, überblendet wird nur über opacity.
// Das DOM bleibt stehen, solange die Slideshow läuft; render() aktualisiert nur die Uhr.
import { hhmm } from "./util.js";

const INTERVAL_MS = 12000;

let mounted = false;
// Jeder Stop erhöht gen; eine alte async-Kette erkennt sich daran nach ihrem await und hört auf.
let gen = 0;
let timer = null;
let list = [];
let index = 0;
let front = 0;

async function next(frame, g) {
  if (g !== gen || !list.length) return;
  const imgs = frame.querySelectorAll(".slide");
  const back = imgs[1 - front];
  back.src = `/api/slides/${encodeURIComponent(list[index++ % list.length])}`;
  try {
    await back.decode();
  } catch {}
  if (g !== gen) return;
  back.classList.add("visible");
  imgs[front].classList.remove("visible");
  front = 1 - front;
  timer = setTimeout(() => next(frame, g), INTERVAL_MS);
}

async function mount(frame) {
  mounted = true;
  const g = gen;
  front = 0;
  frame.innerHTML = `
    <section class="slideshow">
      <img class="slide" alt=""><img class="slide" alt="">
      <div class="slide-clock"></div>
    </section>`;
  let l;
  try {
    l = await (await fetch("/api/slides", { cache: "no-store" })).json();
  } catch {
    l = [];
  }
  if (g !== gen) return;
  list = l;
  // Nicht jedes Mal mit demselben Bild beginnen.
  index = list.length ? Math.floor(Math.random() * list.length) : 0;
  next(frame, g);
}

export function showSlideshow(frame, d) {
  if (!mounted) mount(frame);
  frame.querySelector(".slide-clock").textContent = hhmm(d);
}

export function stopSlideshow() {
  mounted = false;
  gen++;
  clearTimeout(timer);
}
